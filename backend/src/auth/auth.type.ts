export type AuthUser = {
  userId: string;        // Keycloak sub
  username: string;
  email?: string;
  roles: string[];
};