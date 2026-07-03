import { SetMetadata } from '@nestjs/common';
import { Role } from '../role.enum';

export const ROLES_KEY = 'roles';

/** Restrict a handler to the given roles (RolesGuard enforces it). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
