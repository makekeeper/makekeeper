import { randomBytes } from 'node:crypto';
import { GoneException, Injectable, Logger } from '@nestjs/common';
import {
  AppConfigService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';
import {
  decodeRasterPayload,
  encodeRasterPayload,
  type PrintHandoffLink,
  type PrintHandoffRequest,
  type PrintRasterPayload,
} from '@makekeeper/plugin-contract';

// One-time print handoff (#361).
//
// The problem is a browser fact, not a product one: Web Bluetooth exists in
// Chromium only, so Safari and Firefox — and every browser on iOS, which is
// WebKit underneath — cannot reach the printer however willing they are. The
// answer is a short-lived link: park the rendered page, and let a Chromium
// browser standing near the printer print it with no login.
//
// What is parked is the RASTER, nothing else. Not the object's ORef, not its
// name, not even the label code — so the token discloses exactly what the
// sticker would, which is what makes serving it to an anonymous page defensible
// (the ticket's own condition). It also keeps this plugin a driver: it still has
// no idea what a label is.
//
// The link survives failure and dies on success: a Bluetooth connection that
// drops must not cost a new link, so the ceiling is a small number of ATTEMPTS
// rather than one open, and a reported print closes the token for good.

// Long enough to walk to the printer, short enough that a link in somebody's
// clipboard is worthless by the time they wonder what it was.
const TTL_MS = 10 * 60 * 1000;
// Fetches of the payload before the token is spent. A handful: retrying a
// failed connect is normal, retrying fifty times is not this link's business.
const MAX_ATTEMPTS = 10;
// 160 bits of token, in the URL-safe alphabet the rest of the app uses for
// capability links.
const TOKEN_BYTES = 20;

@Injectable()
export class PrintHandoffService {
  private readonly logger = new Logger(PrintHandoffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly context: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  // Parks a page and returns the link to open near the printer. The locale
  // travels in the URL (#211): the page it opens has no session to read one
  // from, and a print button in a language the person does not speak is a
  // worse answer than a longer link.
  async create(
    payload: PrintHandoffRequest,
    req: RequestHeadersLike,
    locale?: string,
  ): Promise<PrintHandoffLink> {
    const raster = decodeRasterPayload(payload);
    // Decoded here rather than in the controller so the one place that turns a
    // wire page into dots is also the place that refuses a page which is not
    // one (`decodeRasterPayload` runs the contract's own `isValidRaster`).
    if (!raster) {
      throw new GoneException(this.i18n.t('printingNiimbot.errors.badRaster'));
    }
    const copies = Math.max(1, Math.round(payload.copies ?? 1));
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    await this.prisma.printHandoff.create({
      data: {
        token,
        widthDots: raster.widthDots,
        heightDots: raster.heightDots,
        rows: Buffer.from(raster.rows),
        copies,
        expiresAt,
      },
    });
    // Expired and spent rows are swept on the next create rather than by a
    // scheduled job: the table only ever holds minutes of traffic, and a sweep
    // that runs when the feature is used cannot drift from it.
    await this.sweep();
    // The posting browser's origin first (#372): the link is opened on another
    // device, so it must be the address this one actually reached.
    const base = this.config.resolvePublicBaseUrl(req, payload.origin);
    const query = locale ? `?lang=${encodeURIComponent(locale)}` : '';
    return {
      url: `${base}/print/niimbot/${token}${query}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // The page behind a token, counting the attempt. Scope enforcement is
  // suspended for the lookup: the caller is an anonymous browser holding a
  // capability token, which is the authority here — the same model as the
  // public `/c/<code>` resolver and the `/d/:token` phone routes.
  async claim(token: string): Promise<PrintRasterPayload> {
    const row = await this.context.runWithoutScope('public-print-handoff', () =>
      this.prisma.printHandoff.findUnique({ where: { token } }),
    );
    if (
      !row ||
      row.printedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      row.attempts >= MAX_ATTEMPTS
    ) {
      // One answer for every dead end — expired, spent, exhausted, never
      // existed — so a caller learns nothing by probing.
      throw new GoneException(
        this.i18n.t('printingNiimbot.handoff.errors.gone'),
      );
    }
    await this.context.runWithoutScope('public-print-handoff', () =>
      this.prisma.printHandoff.update({
        where: { token },
        data: { attempts: { increment: 1 } },
      }),
    );
    return encodeRasterPayload(
      {
        widthDots: row.widthDots,
        heightDots: row.heightDots,
        rows: new Uint8Array(row.rows),
      },
      row.copies,
    );
  }

  // The driver reported paper. The token is spent from here on; a second press
  // of the button gets the same `gone` as an expired link.
  async markPrinted(token: string): Promise<void> {
    await this.context.runWithoutScope('public-print-handoff', async () => {
      // `updateMany` rather than `update`: a token that is already gone is not
      // an error worth raising at a page that has just printed successfully.
      const { count } = await this.prisma.printHandoff.updateMany({
        where: { token, printedAt: null },
        data: { printedAt: new Date() },
      });
      if (count === 0) {
        this.logger.debug(`handoff ${token.slice(0, 6)}… already closed`);
      }
    });
  }

  private async sweep(): Promise<void> {
    await this.context.runWithoutScope('public-print-handoff', () =>
      this.prisma.printHandoff.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            { printedAt: { not: null } },
          ],
        },
      }),
    );
  }
}
