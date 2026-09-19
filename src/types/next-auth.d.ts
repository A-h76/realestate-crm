import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    workspaceId?: string;
    role?: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      workspaceId: string;
      role: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    workspaceId?: string;
    role?: string;
  }
}
