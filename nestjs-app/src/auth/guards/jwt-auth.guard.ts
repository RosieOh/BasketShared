import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Requires a valid Bearer JWT; populates req.user via JwtStrategy. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
