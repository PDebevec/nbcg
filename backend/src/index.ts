import env from './config/env';
import createServer from './app';

const app = createServer();

app.listen(env.PORT, () => {
  console.log(`Backend listening on port ${env.PORT}`);
});