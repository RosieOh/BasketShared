import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../config/configuration';
import { Role } from './role.enum';

export interface JwtPayload {
  sub: string;
  username: string;
  roles: Role[];
}

/** Authenticated principal attached to `req.user`. */
export interface AuthUser {
  userId: string;
  username: string;
  roles: Role[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('auth.jwtSecret', { infer: true }),
    });
  }

  validate(payload: JwtPayload): AuthUser {
    return { userId: payload.sub, username: payload.username, roles: payload.roles };
  }
}
