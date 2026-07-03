import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ADMIN_UI_HTML } from './admin-ui.html';

/**
 * Serves a self-contained admin dashboard at GET /ui. The page is public HTML;
 * it authenticates to the API with a JWT obtained via the login form.
 */
@ApiExcludeController()
@Controller('ui')
export class AdminUiController {
  @Get()
  @SkipThrottle()
  @Header('Content-Type', 'text/html; charset=utf-8')
  index(): string {
    return ADMIN_UI_HTML;
  }
}
