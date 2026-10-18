import {
  Body,
  Controller,
  Get,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CapabilityRegistryService } from '@makekeeper/backend-core';
import {
  PRINT_DRIVER_CAPABILITY_PREFIX,
  decodeRasterPayload,
  type PrintDriverCapability,
  type PrintDriverDescriptor,
  type PrintResult,
} from '@makekeeper/plugin-contract';
import { SubmitPrintJobDto } from './printing.dto';

// Server-side print drivers, for the browser (#362).
//
// Core rather than a plugin, exactly like `/api/refs/resolve`: the drivers are
// registered by whoever owns the hardware (today an external plugin container
// standing next to the printer), and the consumer is whoever has a label — so
// the question "what can print this?" belongs to neither of them. A plugin
// asking another plugin would be the import this architecture forbids (§5.10).
//
// What a browser-side driver does in the tab (#359), this does across the wire:
// the same raster, the same descriptor, the same keyed failures. That is why the
// print dialog needs no idea which kind it is talking to.
@Controller('printing')
@ApiTags('core')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PrintingController {
  constructor(private readonly capabilities: CapabilityRegistryService) {}

  @Get('drivers')
  @ApiOperation({ summary: 'i18n:core.printing.drivers' })
  async drivers(): Promise<PrintDriverDescriptor[]> {
    const registered = this.capabilities.getCapabilities<PrintDriverCapability>(
      PRINT_DRIVER_CAPABILITY_PREFIX,
    );
    const described = await Promise.all(
      // A driver that cannot describe itself is not offered — better a missing
      // button than one that promises a printer nobody can name.
      registered.map((entry) => entry.impl.describe().catch(() => null)),
    );
    return described.filter((d): d is PrintDriverDescriptor => d !== null);
  }

  @Post('print')
  @ApiOperation({ summary: 'i18n:core.printing.print' })
  async print(@Body() body: SubmitPrintJobDto): Promise<PrintResult> {
    const driver = this.capabilities.getCapability<PrintDriverCapability>(
      body.driverId,
    );
    // Unregistered, or its owner is disabled: one answer, the contract's
    // "the feature doesn't exist" (§5.10) phrased as a failed print.
    if (!driver) {
      return { ok: false, errorKey: 'core.printing.errors.unknownDriver' };
    }
    const raster = decodeRasterPayload(body);
    if (!raster) {
      return { ok: false, errorKey: 'core.printing.errors.badRaster' };
    }
    return driver.print(raster, { copies: body.copies });
  }
}
