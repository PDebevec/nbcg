import express from 'express';
import router from './routes';
import { errorMiddleware } from './middleware/error.middleware';

function createServer() {
  const app = express();

  app.use(express.json());
  app.use('/api', router);
  app.use(errorMiddleware);

  return app;
}

export default createServer;