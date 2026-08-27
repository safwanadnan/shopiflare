import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import type { PrismaClient } from "@prisma/client";

export class PrismaSessionStorage implements SessionStorage {
  constructor(private prisma: PrismaClient) {}

  public async storeSession(session: Session): Promise<boolean> {
    const data = this.sessionToRow(session);

    await this.prisma.session.upsert({
      where: { id: session.id },
      update: data,
      create: data,
    });

    return true;
  }

  public async loadSession(id: string): Promise<Session | undefined> {
    const row = await this.prisma.session.findUnique({
      where: { id },
    });

    if (!row) {
      return undefined;
    }

    return this.rowToSession(row);
  }

  public async deleteSession(id: string): Promise<boolean> {
    try {
      await this.prisma.session.delete({ where: { id } });
    } catch {
      return true;
    }

    return true;
  }

  public async deleteSessions(ids: string[]): Promise<boolean> {
    await this.prisma.session.deleteMany({ where: { id: { in: ids } } });
    return true;
  }

  public async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.prisma.session.findMany({
      where: { shop },
      take: 25,
      orderBy: [{ expires: "desc" }],
    });

    return sessions.map((session) => this.rowToSession(session));
  }

  private sessionToRow(session: Session) {
    const sessionParams = session.toObject();

    return {
      id: session.id,
      shop: session.shop,
      state: session.state,
      isOnline: session.isOnline,
      scope: session.scope || null,
      expires: session.expires ? new Date(session.expires) : null,
      accessToken: session.accessToken || "",
      userId: sessionParams.onlineAccessInfo?.associated_user?.id
        ? BigInt(sessionParams.onlineAccessInfo.associated_user.id)
        : null,
      firstName:
        sessionParams.onlineAccessInfo?.associated_user?.first_name || null,
      lastName:
        sessionParams.onlineAccessInfo?.associated_user?.last_name || null,
      email: sessionParams.onlineAccessInfo?.associated_user?.email || null,
      accountOwner:
        sessionParams.onlineAccessInfo?.associated_user?.account_owner || false,
      locale: sessionParams.onlineAccessInfo?.associated_user?.locale || null,
      collaborator:
        sessionParams.onlineAccessInfo?.associated_user?.collaborator || false,
      emailVerified:
        sessionParams.onlineAccessInfo?.associated_user?.email_verified || false,
      refreshToken: sessionParams.refreshToken || null,
      refreshTokenExpires: sessionParams.refreshTokenExpires
        ? new Date(sessionParams.refreshTokenExpires)
        : null,
    };
  }

  private rowToSession(row: any): Session {
    const sessionParams: Record<string, boolean | string | number> = {
      id: row.id,
      shop: row.shop,
      state: row.state,
      isOnline: row.isOnline,
      userId: row.userId ? String(row.userId) : "",
      firstName: row.firstName ? String(row.firstName) : "",
      lastName: row.lastName ? String(row.lastName) : "",
      email: row.email ? String(row.email) : "",
      locale: row.locale ? String(row.locale) : "",
    };

    if (row.accountOwner !== null) {
      sessionParams.accountOwner = row.accountOwner;
    }

    if (row.collaborator !== null) {
      sessionParams.collaborator = row.collaborator;
    }

    if (row.emailVerified !== null) {
      sessionParams.emailVerified = row.emailVerified;
    }

    if (row.expires) {
      sessionParams.expires = new Date(row.expires).getTime();
    }

    if (row.scope) {
      sessionParams.scope = row.scope;
    }

    if (row.accessToken) {
      sessionParams.accessToken = row.accessToken;
    }

    if (row.refreshToken) {
      sessionParams.refreshToken = row.refreshToken;
    }

    if (row.refreshTokenExpires) {
      sessionParams.refreshTokenExpires = new Date(
        row.refreshTokenExpires,
      ).getTime();
    }

    return Session.fromPropertyArray(Object.entries(sessionParams), true);
  }
}
