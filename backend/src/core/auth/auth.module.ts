import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { KeycloakJwtStrategy } from './keycloak.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
  ],
  providers: [AuthService, KeycloakJwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
