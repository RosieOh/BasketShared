import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import type { AppConfig } from '../config/configuration';
import { User } from './entities/user.entity';
import { AuthUser } from './jwt.strategy';
import { Role } from './role.enum';

const BCRYPT_ROUNDS = 10;

export interface LoginResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: string;
  roles: Role[];
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Seed a bootstrap admin on first start so the API is reachable. */
  async onModuleInit(): Promise<void> {
    if ((await this.users.count()) > 0) return;
    const { adminUsername, adminPassword } = this.config.get('auth', { infer: true });
    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
    await this.users.save(
      this.users.create({ username: adminUsername, passwordHash, roles: [Role.ADMIN] }),
    );
    this.logger.log(`Seeded bootstrap admin user '${adminUsername}'`);
  }

  async validateUser(username: string, password: string): Promise<AuthUser | null> {
    const user = await this.users.findOne({ where: { username } });
    if (!user) return null;
    if (!(await bcrypt.compare(password, user.passwordHash))) return null;
    return { userId: user.id, username: user.username, roles: user.roles, tenantId: user.tenantId };
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.validateUser(username, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const token = this.jwt.sign({
      sub: user.userId,
      username: user.username,
      roles: user.roles,
      tenantId: user.tenantId,
    });
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: this.config.get('auth.jwtExpiresIn', { infer: true }),
      roles: user.roles,
    };
  }

  /** Admin-only: create a user in a given tenant. */
  async createUser(input: {
    username: string;
    password: string;
    roles: Role[];
    tenantId?: string;
  }): Promise<{ id: string; username: string; roles: Role[]; tenantId: string }> {
    if (await this.users.exist({ where: { username: input.username } })) {
      throw new ConflictException(`User "${input.username}" already exists`);
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.users.save(
      this.users.create({
        username: input.username,
        passwordHash,
        roles: input.roles,
        tenantId: input.tenantId ?? this.config.get('tenancy.defaultTenant', { infer: true }),
      }),
    );
    return { id: user.id, username: user.username, roles: user.roles, tenantId: user.tenantId };
  }
}
