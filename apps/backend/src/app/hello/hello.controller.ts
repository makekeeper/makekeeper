import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HelloNudgeState } from '@makekeeper/plugin-contract';
import { HelloService } from './hello.service';

// Open to every signed-in user (#368): the card asks each person for a
// personal signal, and each person's close is their own. Not `@Public()` —
// with the multiuser overlay on, an anonymous caller is refused like anywhere
// else; with it off, there is no session and the single reader is "solo".
// The one instance-level action on the card, the daily ping, is not here: it
// goes through the admin-only telemetry routes.
@Controller('hello')
@ApiTags('core')
export class HelloController {
  constructor(private readonly hello: HelloService) {}

  @Get()
  @ApiOperation({ summary: 'i18n:core.hello.stateSummary' })
  state(): Promise<HelloNudgeState> {
    return this.hello.getState();
  }

  @Post('dismiss')
  @ApiOperation({ summary: 'i18n:core.hello.dismissSummary' })
  dismiss(): Promise<HelloNudgeState> {
    return this.hello.dismiss();
  }
}
