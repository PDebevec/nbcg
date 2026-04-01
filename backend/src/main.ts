import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // app.enableCors({
  //   origin: [
  //     'http://localhost:5173', // Vue dev (Vite)
  //     'http://localhost:8080', // optional
  //   ],
  //   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  //   allowedHeaders: ['Content-Type', 'Authorization'],
  //   credentials: true,
  // });
  
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
