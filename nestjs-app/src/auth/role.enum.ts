/** RBAC roles. admin ⊃ operator ⊃ viewer in capability, but checked explicitly. */
export enum Role {
  ADMIN = 'admin', // full control incl. user-implied admin ops
  OPERATOR = 'operator', // can retry/re-drive transfers
  VIEWER = 'viewer', // read-only
}
