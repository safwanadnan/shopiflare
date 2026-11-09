import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { and, eq, inArray, desc, isNotNull, notExists } from "drizzle-orm";
import type { AppDb } from "./db.server";
import { sessions, shopifyAuthStates, type SessionRecord, type InsertSessionRecord } from "./db/schema";
import { acquireShopifyAuthLease, leaseBindings, leaseGeneration, ownedLease, shopifyAuthContext } from "./services/shopify-auth-state.server";

function hasExpiry(expires: Date | null | undefined) {
  return expires != null && Number.isFinite(expires.getTime());
}

export class DrizzleSessionStorage implements SessionStorage {
  private readonly loadedTokens = new WeakMap<Session, string>();
  constructor(private db: AppDb, private env: Env) {}

  public async storeSession(session: Session): Promise<boolean> {
    if (session.accessToken && !session.isOnline && !hasExpiry(session.expires)) {
      throw new Error("Offline Shopify access tokens require an expiry");
    }
    const loaded = this.loadedTokens.get(session);
    if (!session.accessToken) {
      // A delayed SDK 401 may invalidate only the token used by that request.
      if (loaded) {
        await this.db.update(sessions).set({ accessToken: "" }).where(and(
          eq(sessions.id, session.id),
          eq(sessions.shop, session.shop),
          eq(sessions.accessToken, loaded),
        ));
      }
      return true;
    }

    const context = shopifyAuthContext.getStore();
    const lease = context?.lease;
    if (context?.env !== this.env || !lease || lease.shop !== session.shop.toLowerCase() || !context.grantReceived) {
      throw new Error("Shopify credentials must come from a coordinated grant.");
    }

    // The embedded SDK exchanges a verified merchant token in admin auth.
    // Background auth can refresh an installed shop but cannot reinstall it.
    const merchantGrant = context.mode === "admin";
    const where = merchantGrant ? ownedLease : `${ownedLease} AND uninstalledAt IS NULL`;
    const next = leaseBindings(lease, lease.generation + 1);
    const data = Object.entries(this.sessionToRow(session));
    // Column names are fixed by sessionToRow, never by incoming request data.
    const columns = data.map(([key]) => `"${key}"`);
    const values = data.map(([, value]) =>
      value instanceof Date ? value.toISOString() : typeof value === "boolean" ? Number(value) : value,
    );
    // Fence the first write and use its new generation for the rest of the batch.
    const statements = [
      this.env.DB.prepare(`
        UPDATE ShopifyAuthState SET generation = generation + 1
          ${merchantGrant ? ", authorizedAt = MAX(authorizedAt, ?), uninstalledAt = NULL" : ""}
        WHERE ${where}
      `).bind(...(merchantGrant ? [lease.startedAt] : []), ...leaseBindings(lease)),
      this.env.DB.prepare(`
        INSERT INTO Session (${columns.join(", ")})
        SELECT ${columns.map(() => "?").join(", ")} FROM ShopifyAuthState WHERE ${leaseGeneration}
        ON CONFLICT (id) DO UPDATE SET ${columns.filter(column => column !== '"id"').map(column => `${column} = excluded.${column}`).join(", ")}
      `).bind(...values, ...next),
    ];
    if (merchantGrant && lease.uninstalledAt) {
      statements.push(this.env.DB.prepare(`
        UPDATE Shop SET uninstalledAt = NULL, installedAt = ?, updatedAt = ?
        WHERE shopifyDomain = ? AND EXISTS (SELECT 1 FROM ShopifyAuthState WHERE ${leaseGeneration})
      `).bind(new Date(lease.startedAt).toISOString(), new Date().toISOString(), lease.shop, ...next));
    }

    const results = await this.env.DB.batch(statements);
    if (results[0].meta.changes !== 1) throw new Error("Shopify authorization changed before credentials were saved.");
    lease.generation++;
    if (merchantGrant) lease.uninstalledAt = null;
    context.grantReceived = false;
    this.loadedTokens.set(session, session.accessToken);
    return true;
  }

  public async loadSession(id: string): Promise<Session | undefined> {
    const session = await this.readSession(id);
    const context = shopifyAuthContext.getStore();
    if (!context) return session;
    if (context.env !== this.env) throw new Error("Shopify authorization environment mismatch.");

    // The pinned SDK calls loadSession with an ID derived from the verified JWT
    // or the caller's canonical background shop. The SDK refresh window is five minutes.
    const shop = id.match(/^(?:offline_)?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)(?:_\d+)?$/i)?.[1].toLowerCase();
    if (!shop) throw new Error("Invalid Shopify session ID.");
    if (context.lease && context.lease.shop !== shop) throw new Error("Shopify authorization shop mismatch.");
    if (context.lease) return session;
    if (session?.isActive(undefined, 10 * 60_000)) return session;

    context.lease = await acquireShopifyAuthLease(this.env, shop, 10_000);
    if (context.lease.uninstalledAt) return undefined;
    // A concurrent request may have refreshed the session while we waited.
    return this.readSession(id);
  }

  private async readSession(id: string): Promise<Session | undefined> {
    const uninstalled = this.db.select({ shop: shopifyAuthStates.shop })
      .from(shopifyAuthStates)
      .where(and(eq(shopifyAuthStates.shop, sessions.shop), isNotNull(shopifyAuthStates.uninstalledAt)));
    const row = await this.db.select().from(sessions)
      .where(and(eq(sessions.id, id), notExists(uninstalled))).get();
    if (!row?.accessToken || (!row.isOnline && !hasExpiry(row.expires))) return undefined;
    return this.rowToSession(row);
  }

  public async deleteSession(id: string): Promise<boolean> {
    await this.db.delete(sessions).where(eq(sessions.id, id));

    return true;
  }

  public async deleteSessions(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    await this.db.delete(sessions).where(inArray(sessions.id, ids));
    return true;
  }

  public async findSessionsByShop(shop: string): Promise<Session[]> {
    const rows = await this.db.query.sessions.findMany({
      where: eq(sessions.shop, shop),
      limit: 25,
      orderBy: [desc(sessions.expires)],
    });

    return rows.filter(row => row.accessToken && (row.isOnline || hasExpiry(row.expires)))
      .map(row => this.rowToSession(row));
  }

  private sessionToRow(session: Session): InsertSessionRecord {
    const sessionParams = session.toObject();

    return {
      id: session.id,
      shop: session.shop,
      state: session.state,
      isOnline: Boolean(session.isOnline),
      scope: session.scope || null,
      expires: session.expires ? new Date(session.expires) : null,
      accessToken: session.accessToken || "",
      userId: sessionParams.onlineAccessInfo?.associated_user?.id
        ? Number(sessionParams.onlineAccessInfo.associated_user.id)
        : null,
      firstName:
        sessionParams.onlineAccessInfo?.associated_user?.first_name || null,
      lastName:
        sessionParams.onlineAccessInfo?.associated_user?.last_name || null,
      email: sessionParams.onlineAccessInfo?.associated_user?.email || null,
      accountOwner:
        sessionParams.onlineAccessInfo?.associated_user?.account_owner ?? false,
      locale: sessionParams.onlineAccessInfo?.associated_user?.locale || null,
      collaborator:
        sessionParams.onlineAccessInfo?.associated_user?.collaborator ?? false,
      emailVerified:
        sessionParams.onlineAccessInfo?.associated_user?.email_verified ?? false,
      refreshToken: session.refreshToken || sessionParams.refreshToken || null,
      refreshTokenExpires: sessionParams.refreshTokenExpires
        ? new Date(sessionParams.refreshTokenExpires)
        : null,
    };
  }

  private rowToSession(row: SessionRecord): Session {
    const sessionParams: Record<string, boolean | string | number> = {
      id: row.id,
      shop: row.shop,
      state: row.state,
      isOnline: Boolean(row.isOnline),
      userId: row.userId != null ? String(row.userId) : "",
      firstName: row.firstName ? String(row.firstName) : "",
      lastName: row.lastName ? String(row.lastName) : "",
      email: row.email ? String(row.email) : "",
      locale: row.locale ? String(row.locale) : "",
    };

    if (row.accountOwner !== null && row.accountOwner !== undefined) {
      sessionParams.accountOwner = Boolean(row.accountOwner);
    }

    if (row.collaborator !== null && row.collaborator !== undefined) {
      sessionParams.collaborator = Boolean(row.collaborator);
    }

    if (row.emailVerified !== null && row.emailVerified !== undefined) {
      sessionParams.emailVerified = Boolean(row.emailVerified);
    }

    if (row.expires) {
      sessionParams.expires = new Date(row.expires).getTime();
    }

    if (row.refreshToken) {
      sessionParams.refreshToken = row.refreshToken;
    }

    if (row.refreshTokenExpires) {
      sessionParams.refreshTokenExpires = new Date(
        row.refreshTokenExpires,
      ).getTime();
    }

    if (row.accessToken) {
      sessionParams.accessToken = row.accessToken;
    }

    if (row.scope) {
      sessionParams.scope = row.scope;
    }

    const session = Session.fromPropertyArray(Object.entries(sessionParams), true);
    this.loadedTokens.set(session, row.accessToken);
    return session;
  }
}
