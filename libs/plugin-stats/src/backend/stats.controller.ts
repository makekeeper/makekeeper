import {
  Controller,
  Get,
  Headers,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOAuth2, ApiTags } from '@nestjs/swagger';
import { PluginOwner } from '@makekeeper/backend-core';
import { StatsService } from './stats.service';
import {
  StatsGraphQueryDto,
  StatsGroupedQueryDto,
  StatsSeriesQueryDto,
} from './stats.dto';

@PluginOwner('stats')
@Controller('stats')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiTags('stats')
@ApiBearerAuth()
@ApiOAuth2([])
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  // Compact per-day series for one declared metric, read straight from the
  // aggregate table. `metric` is validated against the enabled providers in the
  // service; unknown metrics 400. Locale is threaded for the error message.
  @Get('series')
  async getSeries(
    @Query() query: StatsSeriesQueryDto,
    @Headers('x-locale') locale?: string,
  ): ReturnType<StatsService['getSeries']> {
    const dimension =
      query.dimensionKey && query.dimensionValue
        ? { key: query.dimensionKey, value: query.dimensionValue }
        : undefined;
    return this.stats.getSeries(query.metric, query.days, dimension, locale);
  }

  // Grouped per-day series — one entry per dimension value of a dimensioned
  // metric (e.g. per provider+model for chat.usage.*). Feeds multi-row widgets.
  @Get('series-grouped')
  async getGroupedSeries(
    @Query() query: StatsGroupedQueryDto,
    @Headers('x-locale') locale?: string,
  ): ReturnType<StatsService['getGroupedSeries']> {
    return this.stats.getGroupedSeries(query.metric, query.days, locale);
  }

  // A relational graph (e.g. Sankey) for one window, proxied from the owning
  // plugin's graph provider. `key` is validated against the enabled graph
  // providers in the service.
  @Get('graph')
  async getGraph(
    @Query() query: StatsGraphQueryDto,
    @Headers('x-locale') locale?: string,
  ): ReturnType<StatsService['getGraph']> {
    return this.stats.getGraph(query.key, query.days, locale);
  }
}
