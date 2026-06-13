import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { KeycloakJwtStrategy } from './keycloak.strategy';
import { ResourceAccessService } from './resource-access.service';

@Global()
@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [KeycloakJwtStrategy, ResourceAccessService],
  exports: [ResourceAccessService],
})
export class AuthModule {}
