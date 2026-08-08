/**
 * Nest's `MulterOptions` interface omits `defParamCharset`, but the interceptors
 * spread their options straight into `multer(...)` (see
 * `@nestjs/platform-express/multer/interceptors/files.interceptor.js`), and both
 * multer 2.x and `@types/multer` support it. Declared here so the file upload
 * endpoints can set `defParamCharset: 'utf8'` without a cast.
 */
// The import is what makes this file a module, so the block below *augments*
// the existing interface instead of declaring a new ambient module that shadows it.
import '@nestjs/platform-express';

declare module '@nestjs/platform-express/multer/interfaces/multer-options.interface' {
  interface MulterOptions {
    /** Charset used to decode multipart parameters such as `filename`. Multer defaults to `latin1`. */
    defParamCharset?: string;
  }
}
