import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { eq, inArray, desc } from "drizzle-orm";
import type { AppDb } from "./db.server";
import { sessions, type SessionRecord, type InsertSessionRecord } from "./db/schema";

export class DrizzleSessionStorage implements SessionStorage {
  constructor(private db: AppDb) {}

  public async storeSession(session: Session): Promise<boolean> {
    const data = this.sessionToRow(session);

    await this.db
      .insert(sessions)
      .values(data)
      .onConflictDoUpdate({
        target: sessions.id,
        set: data,
      });

    return true;
  }

  public async loadSession(id: string): Promise<Session | undefined> {
    const row = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, id),
    });

    if (!row) {
      return undefined;
    }

    return this.rowToSession(row);
  }

  public async deleteSession(id: string): Promise<boolean> {
    try {
      await this.db.delete(sessions).where(eq(sessions.id, id));
    } catch {
      return true;
    }

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

    return rows.map((session) => this.rowToSession(session));
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

    return Session.fromPropertyArray(Object.entries(sessionParams), true);
  }
}

// Backwards-compatible alias
export const PrismaSessionStorage = DrizzleSessionStorage;
