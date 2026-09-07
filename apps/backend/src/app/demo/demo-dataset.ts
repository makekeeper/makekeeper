/**
 * The demo workshop MakeKeeper seeds into an empty instance (#339): projects
 * with tasks, an inventory with a category tree and typed properties, storages
 * with occupied cells, suppliers and orders in every status, and several months
 * of stock and activity history. Grown out of the dev tooling of #273, whose
 * seed script this replaced — one dataset, in the product, so what a stranger
 * meets on a first install and what the screenshots show cannot drift apart.
 *
 * The string literals here are *content* — rows a user could have typed, and
 * renames the moment the instance is theirs — not UI text, so the i18n rule of
 * CLAUDE.md 5.5 does not apply to them. Only the banner that announces the
 * data is UI, and that lives in the frontend locale files.
 *
 * Every row carries a `demo_` id prefix. That prefix is the whole removal
 * contract: `DEMO_TABLES` deletes by it and touches nothing else.
 */
import { formatObjectRef } from '@makekeeper/plugin-contract';
import type { PrismaService } from '@makekeeper/backend-core';

// Narrower than PrismaService so a `$transaction` client satisfies it too — the
// same shape `ProjectGroupWriter` uses in plugin-projects.
export type DemoSeedWriter = Pick<
  PrismaService,
  | 'itemCategory'
  | 'categoryProperty'
  | 'storage'
  | 'tag'
  | 'tagLink'
  | 'component'
  | 'componentPropertyValue'
  | 'project'
  | 'task'
  | 'activityEvent'
  | 'projectComponent'
  | 'supplier'
  | 'order'
  | 'orderComponent'
  | 'trackingEvent'
  | 'stockMovement'
  | 'taskComponent'
  | 'taskOrderDependency'
>;

export interface DemoSeedOptions {
  // The multiuser scope the rows belong to; null while the overlay is off.
  scopeId: string | null;
  // The project group every demo project sits in (#285) — resolved by the
  // caller, because naming that group is the projects plugin's business.
  groupId: string;
}

export interface DemoSeedCounts {
  categories: number;
  properties: number;
  items: number;
  storages: number;
  projects: number;
  tasks: number;
  orders: number;
  orderLines: number;
  movements: number;
  tags: number;
  tagLinks: number;
  activity: number;
}

// Every table the set writes into, in delete-safe order (children first).
// Cascades would cover most of it; the list stays explicit so the removal is
// readable and provably confined to the `demo_` prefix.
export const DEMO_TABLES = [
  'TaskOrderDependency',
  'TaskComponent',
  'TrackingEvent',
  'OrderComponent',
  'StockMovement',
  'Order',
  'ActivityEvent',
  'ProjectComponent',
  'Task',
  'Project',
  'TagLink',
  'Tag',
  'ComponentPropertyValue',
  'Component',
  'CategoryProperty',
  'ItemCategory',
  'Supplier',
  'Storage',
] as const;

// The id prefix that marks a row as demo data, everywhere.
export const DEMO_ID_PREFIX = 'demo_';

// Tag links address their target by canonical reference. Formatting one by
// hand is banned (CLAUDE.md §5.9) — a null here would mean this file invented
// an id shape the contract rejects, which is a bug in the dataset, not data.
const ref = (
  pluginId: string,
  entityType: string,
  entityId: string,
): string => {
  const formatted = formatObjectRef({ pluginId, entityType, entityId });
  if (!formatted) throw new Error(`core.errors.invalidObjectRef:${entityId}`);
  return formatted;
};

type TaskSpec = {
  title: string;
  done: boolean;
  priority: string;
  at: Date;
  due?: Date;
};

type ProjectSpec = {
  id: string;
  title: string;
  status: string;
  position?: number;
  description?: string;
  startDate?: Date;
  dueDate?: Date;
  budgetPlanned?: number;
  budgetCurrency?: string;
  createdAt: Date;
  tags: string[];
  tasks: TaskSpec[];
  // [componentId, needed, reserved]
  items: [string, number, number][];
};

type ItemSpec = {
  id: string;
  name: string;
  sku?: string;
  category: string;
  quantity: number;
  minQuantity: number;
  unit?: string;
  description?: string;
  links?: { label: string; url: string }[];
  cell?: [number, number];
  props?: Record<string, string | number>;
  tags?: string[];
};

export async function seedDemoData(
  prisma: DemoSeedWriter,
  { scopeId, groupId }: DemoSeedOptions,
): Promise<DemoSeedCounts> {
  // Every date is relative to the moment of seeding, so the set never looks
  // stale on an instance installed a year from now.
  const now = new Date();
  const day = (daysAgo: number, hour = 12): Date => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, (daysAgo * 7) % 60, 0, 0);
    return d;
  };
  const ahead = (days: number): Date => day(-days);

  // ── Categories (a real tree with typed properties, #205) ──────────────────
  const categories = [
    {
      id: 'demo_cat_elec',
      name: 'Electronics',
      parentId: null,
      order: 0,
    },
    {
      id: 'demo_cat_res',
      name: 'Resistors',
      parentId: 'demo_cat_elec',
      order: 0,
    },
    {
      id: 'demo_cat_cap',
      name: 'Capacitors',
      parentId: 'demo_cat_elec',
      order: 1,
    },
    {
      id: 'demo_cat_mcu',
      name: 'Microcontrollers',
      parentId: 'demo_cat_elec',
      order: 2,
    },
    {
      id: 'demo_cat_sens',
      name: 'Sensors',
      parentId: 'demo_cat_elec',
      order: 3,
    },
    {
      id: 'demo_cat_disp',
      name: 'Displays',
      parentId: 'demo_cat_elec',
      order: 4,
    },
    { id: 'demo_cat_fix', name: 'Fasteners', parentId: null, order: 1 },
    {
      id: 'demo_cat_screw',
      name: 'Screws & nuts',
      parentId: 'demo_cat_fix',
      order: 0,
    },
    {
      id: 'demo_cat_cons',
      name: 'Consumables',
      parentId: null,
      order: 2,
    },
  ];
  for (const c of categories) {
    await prisma.itemCategory.create({
      data: { ...c, scopeId, createdAt: day(160), updatedAt: day(160) },
    });
  }

  const properties = [
    {
      id: 'demo_prop_res_r',
      categoryId: 'demo_cat_res',
      name: 'Resistance',
      type: 'number',
      unit: 'Ohm',
      required: true,
      order: 0,
    },
    {
      id: 'demo_prop_res_w',
      categoryId: 'demo_cat_res',
      name: 'Power rating',
      type: 'select',
      options: JSON.stringify(['0.125 W', '0.25 W', '0.5 W', '1 W']),
      order: 1,
    },
    {
      id: 'demo_prop_cap_c',
      categoryId: 'demo_cat_cap',
      name: 'Capacitance',
      type: 'number',
      unit: 'uF',
      required: true,
      order: 0,
    },
    {
      id: 'demo_prop_cap_v',
      categoryId: 'demo_cat_cap',
      name: 'Voltage',
      type: 'number',
      unit: 'V',
      order: 1,
    },
    {
      id: 'demo_prop_mcu_if',
      categoryId: 'demo_cat_mcu',
      name: 'Connector',
      type: 'select',
      options: JSON.stringify(['USB-C', 'micro-USB', 'UART']),
      order: 0,
    },
    {
      id: 'demo_prop_scr_d',
      categoryId: 'demo_cat_screw',
      name: 'Diameter',
      type: 'number',
      unit: 'mm',
      required: true,
      order: 0,
    },
    {
      id: 'demo_prop_scr_l',
      categoryId: 'demo_cat_screw',
      name: 'Length',
      type: 'number',
      unit: 'mm',
      order: 1,
    },
  ];
  for (const p of properties) {
    await prisma.categoryProperty.create({
      data: {
        id: p.id,
        categoryId: p.categoryId,
        name: p.name,
        type: p.type,
        unit: p.unit ?? null,
        required: p.required ?? false,
        options: p.options ?? null,
        order: p.order,
        createdAt: day(160),
        updatedAt: day(160),
      },
    });
  }

  // ── Storages: a demo root of its own, so no existing cell is disturbed ─────
  await prisma.storage.create({
    data: {
      id: 'demo_st_root',
      name: 'Workshop',
      location: 'Balcony',
      scopeId,
      createdAt: day(158),
      updatedAt: day(158),
    },
  });
  await prisma.storage.create({
    data: {
      id: 'demo_st_shelf',
      name: 'Shelf A',
      parentId: 'demo_st_root',
      gridRows: 4,
      gridCols: 6,
      scopeId,
      createdAt: day(158),
      updatedAt: day(158),
    },
  });
  await prisma.storage.create({
    data: {
      id: 'demo_st_drawer',
      name: 'Fastener drawer',
      parentId: 'demo_st_root',
      gridRows: 3,
      gridCols: 4,
      scopeId,
      createdAt: day(150),
      updatedAt: day(150),
    },
  });
  await prisma.storage.create({
    data: {
      id: 'demo_st_bench',
      name: 'Workbench',
      parentId: 'demo_st_root',
      location: 'Left of the window',
      scopeId,
      createdAt: day(150),
      updatedAt: day(150),
    },
  });

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tags = [
    { id: 'demo_tag_smart', name: 'Smart home', color: 'sky' },
    { id: 'demo_tag_print', name: '3D printing', color: 'violet' },
    { id: 'demo_tag_urgent', name: 'Urgent', color: 'red' },
    { id: 'demo_tag_smd', name: 'SMD', color: 'amber' },
  ];
  for (const t of tags) {
    await prisma.tag.create({
      data: { ...t, scopeId, createdAt: day(140), updatedAt: day(140) },
    });
  }
  let tagLinkSeq = 0;
  const link = async (tagId: string, objectRef: string): Promise<void> => {
    await prisma.tagLink.create({
      data: {
        id: `demo_tl_${++tagLinkSeq}`,
        tagId,
        ref: objectRef,
        scopeId,
        createdAt: day(120),
      },
    });
  };

  // ── Inventory ─────────────────────────────────────────────────────────────
  const items: ItemSpec[] = [
    {
      id: 'demo_it_r220',
      name: 'Resistor 220 Ohm',
      sku: 'R-220-025',
      category: 'demo_cat_res',
      quantity: 180,
      minQuantity: 50,
      cell: [0, 0],
      props: { demo_prop_res_r: 220, demo_prop_res_w: '0.25 W' },
      tags: ['demo_tag_smd'],
    },
    {
      id: 'demo_it_r1k',
      name: 'Resistor 1 kOhm',
      sku: 'R-1K-025',
      category: 'demo_cat_res',
      quantity: 240,
      minQuantity: 50,
      cell: [0, 1],
      props: { demo_prop_res_r: 1000, demo_prop_res_w: '0.25 W' },
    },
    {
      id: 'demo_it_r10k',
      name: 'Resistor 10 kOhm',
      sku: 'R-10K-025',
      category: 'demo_cat_res',
      quantity: 32,
      minQuantity: 50,
      cell: [0, 2],
      props: { demo_prop_res_r: 10000, demo_prop_res_w: '0.25 W' },
    },
    {
      id: 'demo_it_c100n',
      name: 'Capacitor 100 nF',
      sku: 'C-104-50V',
      category: 'demo_cat_cap',
      quantity: 120,
      minQuantity: 40,
      cell: [0, 3],
      props: { demo_prop_cap_c: 0.1, demo_prop_cap_v: 50 },
    },
    {
      id: 'demo_it_c10u',
      name: 'Capacitor 10 uF',
      sku: 'C-106-25V',
      category: 'demo_cat_cap',
      quantity: 64,
      minQuantity: 20,
      cell: [0, 4],
      props: { demo_prop_cap_c: 10, demo_prop_cap_v: 25 },
    },
    {
      id: 'demo_it_c470u',
      name: 'Capacitor 470 uF',
      sku: 'C-477-16V',
      category: 'demo_cat_cap',
      quantity: 8,
      minQuantity: 12,
      cell: [0, 5],
      props: { demo_prop_cap_c: 470, demo_prop_cap_v: 16 },
    },
    {
      id: 'demo_it_esp32c3',
      name: 'ESP32-C3 SuperMini',
      sku: 'ESP32-C3-SM',
      category: 'demo_cat_mcu',
      quantity: 6,
      minQuantity: 2,
      cell: [1, 0],
      description: 'Compact ESP32-C3 board, Wi-Fi + BLE, 5 V over USB-C.',
      links: [
        {
          label: 'Datasheet',
          url: 'https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf',
        },
      ],
      props: { demo_prop_mcu_if: 'USB-C' },
      tags: ['demo_tag_smart'],
    },
    {
      id: 'demo_it_d1mini',
      name: 'Wemos D1 mini (ESP8266)',
      sku: 'D1-MINI',
      category: 'demo_cat_mcu',
      quantity: 3,
      minQuantity: 2,
      cell: [1, 1],
      props: { demo_prop_mcu_if: 'micro-USB' },
      tags: ['demo_tag_smart'],
    },
    {
      id: 'demo_it_pico',
      name: 'Raspberry Pi Pico',
      sku: 'RP2040-PICO',
      category: 'demo_cat_mcu',
      quantity: 2,
      minQuantity: 1,
      cell: [1, 2],
      props: { demo_prop_mcu_if: 'micro-USB' },
    },
    {
      id: 'demo_it_nano',
      name: 'Arduino Nano (clone)',
      sku: 'NANO-CH340',
      category: 'demo_cat_mcu',
      quantity: 4,
      minQuantity: 2,
      cell: [1, 3],
      props: { demo_prop_mcu_if: 'micro-USB' },
    },
    {
      id: 'demo_it_bme280',
      name: 'BME280 sensor',
      sku: 'BME280-I2C',
      category: 'demo_cat_sens',
      quantity: 3,
      minQuantity: 1,
      cell: [1, 4],
      description: 'Temperature, humidity and pressure over I2C.',
      tags: ['demo_tag_smart'],
    },
    {
      id: 'demo_it_ds18b20',
      name: 'DS18B20 sensor (waterproof)',
      sku: 'DS18B20-WP',
      category: 'demo_cat_sens',
      quantity: 5,
      minQuantity: 2,
      cell: [1, 5],
    },
    {
      id: 'demo_it_hcsr04',
      name: 'Ultrasonic range finder HC-SR04',
      sku: 'HC-SR04',
      category: 'demo_cat_sens',
      quantity: 2,
      minQuantity: 1,
      cell: [2, 0],
    },
    {
      id: 'demo_it_pir',
      name: 'PIR motion sensor AM312',
      sku: 'AM312',
      category: 'demo_cat_sens',
      quantity: 0,
      minQuantity: 2,
      cell: [2, 1],
      tags: ['demo_tag_smart', 'demo_tag_urgent'],
    },
    {
      id: 'demo_it_oled',
      name: 'OLED display 0.96" SSD1306',
      sku: 'OLED-096-I2C',
      category: 'demo_cat_disp',
      quantity: 4,
      minQuantity: 1,
      cell: [2, 2],
    },
    {
      id: 'demo_it_tft',
      name: 'TFT display 1.8" ST7735',
      sku: 'TFT-18-SPI',
      category: 'demo_cat_disp',
      quantity: 1,
      minQuantity: 1,
      cell: [2, 3],
    },
    {
      id: 'demo_it_ws2812',
      name: 'WS2812B strip, 60 LED/m',
      sku: 'WS2812B-60',
      category: 'demo_cat_elec',
      quantity: 4.5,
      minQuantity: 2,
      unit: 'm',
      cell: [2, 4],
      tags: ['demo_tag_smart'],
    },
    {
      id: 'demo_it_psu5v',
      name: 'Power supply 5 V / 3 A',
      sku: 'PSU-5V3A',
      category: 'demo_cat_elec',
      quantity: 2,
      minQuantity: 1,
      cell: [2, 5],
    },
    {
      id: 'demo_it_psu12v',
      name: 'Power supply 12 V / 2 A',
      sku: 'PSU-12V2A',
      category: 'demo_cat_elec',
      quantity: 1,
      minQuantity: 1,
      cell: [3, 0],
    },
    {
      id: 'demo_it_mgtf',
      name: 'Silicone wire 26 AWG',
      category: 'demo_cat_elec',
      quantity: 18,
      minQuantity: 5,
      unit: 'm',
      cell: [3, 1],
    },
    {
      id: 'demo_it_dupont',
      name: 'Dupont jumper F-F, 20 cm',
      sku: 'DUP-FF-20',
      category: 'demo_cat_elec',
      quantity: 40,
      minQuantity: 20,
      cell: [3, 2],
    },
    {
      id: 'demo_it_m3x10',
      name: 'Screw M3x10 DIN 912',
      sku: 'M3X10-912',
      category: 'demo_cat_screw',
      quantity: 12,
      minQuantity: 50,
      props: { demo_prop_scr_d: 3, demo_prop_scr_l: 10 },
      tags: ['demo_tag_print'],
    },
    {
      id: 'demo_it_m3x16',
      name: 'Screw M3x16 DIN 912',
      sku: 'M3X16-912',
      category: 'demo_cat_screw',
      quantity: 64,
      minQuantity: 50,
      props: { demo_prop_scr_d: 3, demo_prop_scr_l: 16 },
    },
    {
      id: 'demo_it_m3nut',
      name: 'Nut M3',
      sku: 'M3-NUT',
      category: 'demo_cat_screw',
      quantity: 210,
      minQuantity: 100,
      props: { demo_prop_scr_d: 3 },
    },
    {
      id: 'demo_it_m3insert',
      name: 'Brass insert M3x5x4',
      sku: 'M3-INSERT',
      category: 'demo_cat_screw',
      quantity: 88,
      minQuantity: 40,
      tags: ['demo_tag_print'],
    },
    {
      id: 'demo_it_pla',
      name: 'PLA filament, black, 1.75 mm',
      sku: 'PLA-BLK-1KG',
      category: 'demo_cat_cons',
      quantity: 0.6,
      minQuantity: 1,
      unit: 'kg',
      tags: ['demo_tag_print'],
    },
    {
      id: 'demo_it_petg',
      name: 'PETG filament, clear, 1.75 mm',
      sku: 'PETG-CLR-1KG',
      category: 'demo_cat_cons',
      quantity: 2,
      minQuantity: 1,
      unit: 'kg',
      tags: ['demo_tag_print'],
    },
    {
      id: 'demo_it_solder',
      name: 'Solder Sn63Pb37, 0.8 mm',
      sku: 'SN63-08',
      category: 'demo_cat_cons',
      quantity: 0.15,
      minQuantity: 0.5,
      unit: 'kg',
    },
    {
      id: 'demo_it_flux',
      name: 'RMA flux gel',
      category: 'demo_cat_cons',
      quantity: 1,
      minQuantity: 1,
      unit: 'pcs',
    },
    {
      id: 'demo_it_shrink',
      name: 'Heat shrink 3 mm, black',
      category: 'demo_cat_cons',
      quantity: 3,
      minQuantity: 2,
      unit: 'm',
    },
  ];

  for (const [i, it] of items.entries()) {
    const created = day(150 - i * 3);
    const onShelf = it.cell !== undefined;
    const inDrawer = it.category === 'demo_cat_screw';
    await prisma.component.create({
      data: {
        id: it.id,
        name: it.name,
        sku: it.sku ?? null,
        description: it.description ?? null,
        categoryId: it.category,
        quantity: it.quantity,
        minQuantity: it.minQuantity,
        unit: it.unit ?? 'pcs',
        links: it.links ? JSON.stringify(it.links) : null,
        storageId: onShelf
          ? 'demo_st_shelf'
          : inDrawer
            ? 'demo_st_drawer'
            : 'demo_st_bench',
        storageRow: it.cell
          ? it.cell[0]
          : inDrawer
            ? Math.floor((i - 21) / 4)
            : null,
        storageCol: it.cell ? it.cell[1] : inDrawer ? (i - 21) % 4 : null,
        scopeId,
        createdAt: created,
        updatedAt: created,
      },
    });
    for (const [propertyId, value] of Object.entries(it.props ?? {})) {
      await prisma.componentPropertyValue.create({
        data: {
          id: `demo_pv_${it.id}_${propertyId}`,
          componentId: it.id,
          propertyId,
          valueText: typeof value === 'string' ? value : null,
          valueNumber: typeof value === 'number' ? value : null,
          createdAt: created,
          updatedAt: created,
        },
      });
    }
    for (const tagId of it.tags ?? []) {
      await link(tagId, ref('inventory', 'component', it.id));
    }
  }

  // ── Projects, tasks, reservations ─────────────────────────────────────────
  const projects: ProjectSpec[] = [
    {
      id: 'demo_pr_lamp',
      title: 'Smart lamp on ESP32',
      status: 'IN_PROGRESS',
      position: 0,
      description:
        'Desk lamp with an addressable strip, driven from Home Assistant over MQTT.',
      startDate: day(60),
      dueDate: ahead(12),
      budgetPlanned: 4500,
      budgetCurrency: 'EUR',
      createdAt: day(62),
      tags: ['demo_tag_smart'],
      tasks: [
        {
          title: 'Breadboard prototype',
          done: true,
          priority: 'HIGH',
          at: day(58),
        },
        {
          title: 'Firmware: MQTT + scenes',
          done: true,
          priority: 'HIGH',
          at: day(48),
        },
        {
          title: 'Lay out the 5 V power board',
          done: false,
          priority: 'MEDIUM',
          at: day(30),
          due: ahead(5),
        },
        {
          title: 'Print the enclosure and diffuser',
          done: false,
          priority: 'MEDIUM',
          at: day(21),
          due: ahead(9),
        },
        {
          title: '24 h thermal soak test',
          done: false,
          priority: 'LOW',
          at: day(14),
        },
      ],
      items: [
        ['demo_it_esp32c3', 1, 1],
        ['demo_it_ws2812', 3, 3],
        ['demo_it_psu5v', 1, 1],
        ['demo_it_c470u', 2, 0],
        ['demo_it_m3x16', 8, 8],
        ['demo_it_petg', 1, 0],
      ] as [string, number, number][],
    },
    {
      id: 'demo_pr_meteo',
      title: 'Balcony weather station',
      status: 'TESTING',
      position: 0,
      description:
        'BME280 + ESP8266, powered from a power bank, reports into Home Assistant.',
      startDate: day(95),
      dueDate: day(5),
      budgetPlanned: 2200,
      budgetCurrency: 'EUR',
      createdAt: day(98),
      tags: ['demo_tag_smart'],
      tasks: [
        {
          title: 'Find a rain-proof enclosure',
          done: true,
          priority: 'MEDIUM',
          at: day(94),
        },
        {
          title: 'Calibrate the humidity sensor',
          done: true,
          priority: 'HIGH',
          at: day(70),
        },
        {
          title: 'Measure battery life',
          done: false,
          priority: 'MEDIUM',
          at: day(20),
        },
      ],
      items: [
        ['demo_it_bme280', 1, 1],
        ['demo_it_d1mini', 1, 1],
        ['demo_it_mgtf', 2, 0],
      ] as [string, number, number][],
    },
    {
      id: 'demo_pr_shelf',
      title: 'Backlit shelf',
      status: 'COMPLETED',
      position: 0,
      description: 'Plywood wall shelf, 12 V strip with a motion sensor.',
      startDate: day(140),
      dueDate: day(96),
      budgetPlanned: 6000,
      budgetCurrency: 'EUR',
      createdAt: day(142),
      tags: ['demo_tag_print'],
      tasks: [
        {
          title: 'Cut the plywood',
          done: true,
          priority: 'HIGH',
          at: day(138),
        },
        {
          title: 'Sand, oil and paint',
          done: true,
          priority: 'MEDIUM',
          at: day(128),
        },
        {
          title: 'Mount the strip and the power supply',
          done: true,
          priority: 'HIGH',
          at: day(112),
        },
        {
          title: 'Hang it on the wall',
          done: true,
          priority: 'LOW',
          at: day(99),
        },
      ],
      items: [
        ['demo_it_psu12v', 1, 0],
        ['demo_it_pir', 1, 0],
        ['demo_it_m3insert', 12, 0],
      ] as [string, number, number][],
    },
    {
      id: 'demo_pr_aqua',
      title: 'Aquarium controller',
      status: 'PLANNING',
      position: 0,
      description:
        'Scheduled light, top-up pump, DS18B20 temperature. Still sketching the schematic.',
      startDate: day(18),
      dueDate: ahead(45),
      budgetCurrency: 'EUR',
      createdAt: day(18),
      tags: [],
      tasks: [
        {
          title: 'Decide: relay or triac',
          done: false,
          priority: 'HIGH',
          at: day(17),
        },
        {
          title: 'Draw up the shopping list',
          done: true,
          priority: 'MEDIUM',
          at: day(16),
        },
        {
          title: 'Fit an enclosure into the panel',
          done: false,
          priority: 'LOW',
          at: day(9),
        },
      ],
      items: [
        ['demo_it_ds18b20', 2, 2],
        ['demo_it_pico', 1, 1],
        ['demo_it_oled', 1, 0],
      ] as [string, number, number][],
    },
    {
      id: 'demo_pr_bench',
      title: 'Workbench organiser',
      status: 'IDEA',
      position: 0,
      description:
        'Printed bins for small parts, clipping together into a modular wall.',
      createdAt: day(6),
      budgetCurrency: 'EUR',
      tags: ['demo_tag_print'],
      tasks: [
        {
          title: 'Measure the free wall',
          done: false,
          priority: 'LOW',
          at: day(5),
        },
      ],
      items: [['demo_it_pla', 1, 0]] as [string, number, number][],
    },
  ];

  let taskSeq = 0;
  let pcSeq = 0;
  let actSeq = 0;
  const taskIds: Record<string, string[]> = {};

  for (const p of projects) {
    await prisma.project.create({
      data: {
        id: p.id,
        title: p.title,
        description: p.description ?? null,
        status: p.status,
        position: p.position ?? 0,
        startDate: p.startDate ?? null,
        dueDate: p.dueDate ?? null,
        budgetPlanned: p.budgetPlanned ?? null,
        budgetCurrency: p.budgetCurrency ?? 'USD',
        groupId,
        scopeId,
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
      },
    });
    for (const tagId of p.tags)
      await link(tagId, ref('projects', 'project', p.id));

    taskIds[p.id] = [];
    for (const t of p.tasks) {
      const id = `demo_tk_${++taskSeq}`;
      taskIds[p.id].push(id);
      await prisma.task.create({
        data: {
          id,
          projectId: p.id,
          title: t.title,
          isCompleted: t.done,
          priority: t.priority,
          dueDate: t.due ?? null,
          createdAt: t.at,
        },
      });
      if (t.done) {
        await prisma.activityEvent.create({
          data: {
            id: `demo_ae_${++actSeq}`,
            projectId: p.id,
            kind: 'task_completed',
            scopeId,
            createdAt: day(
              Math.max(
                1,
                Math.round((Number(now) - Number(t.at)) / 86400000) - 4,
              ),
            ),
          },
        });
      }
    }
    for (const [componentId, needed, reserved] of p.items) {
      await prisma.projectComponent.create({
        data: {
          id: `demo_pc_${++pcSeq}`,
          projectId: p.id,
          componentId,
          neededQty: needed,
          reservedQty: reserved,
        },
      });
    }
  }

  // A few board moves / status changes so the activity metric is not only tasks.
  for (const [i, projectId] of [
    'demo_pr_lamp',
    'demo_pr_meteo',
    'demo_pr_shelf',
    'demo_pr_lamp',
    'demo_pr_aqua',
  ].entries()) {
    await prisma.activityEvent.create({
      data: {
        id: `demo_ae_${++actSeq}`,
        projectId,
        kind: i % 2 === 0 ? 'status_changed' : 'board_moved',
        scopeId,
        createdAt: day(90 - i * 17),
      },
    });
  }

  // ── Logistics: suppliers, orders in every status, tracking, receipts ───────
  const suppliers = [
    {
      id: 'demo_sup_ali',
      name: 'AliExpress',
      url: 'https://aliexpress.com',
      country: 'CN',
      trackingUrlTemplate: 'https://t.17track.net/en#nums={tracking}',
    },
    {
      id: 'demo_sup_lcsc',
      name: 'LCSC',
      url: 'https://lcsc.com',
      country: 'CN',
    },
    {
      id: 'demo_sup_chip',
      name: 'Mouser',
      url: 'https://mouser.com',
      country: 'US',
    },
  ];
  for (const s of suppliers) {
    await prisma.supplier.create({
      data: { ...s, scopeId, createdAt: day(150) },
    });
  }

  const orders = [
    {
      id: 'demo_or_cart',
      storeName: 'AliExpress',
      supplierId: 'demo_sup_ali',
      status: 'CART',
      orderDate: day(2),
      projectId: 'demo_pr_aqua',
      currency: 'EUR',
      totalCost: 1890,
      items: [
        ['demo_it_r10k', 100, 0, 1.4],
        ['demo_it_pir', 5, 0, 96],
        ['demo_it_oled', 2, 0, 310],
      ] as [string, number, number, number][],
    },
    {
      id: 'demo_or_ordered',
      storeName: 'LCSC',
      supplierId: 'demo_sup_lcsc',
      status: 'ORDERED',
      orderDate: day(9),
      estimatedDelivery: ahead(16),
      currency: 'USD',
      totalCost: 42.7,
      storageId: 'demo_st_root',
      items: [
        ['demo_it_c470u', 50, 0, 0.12],
        ['demo_it_esp32c3', 5, 0, 3.9],
        ['demo_it_solder', 1, 0, 12.5],
      ] as [string, number, number, number][],
    },
    {
      id: 'demo_or_shipped',
      storeName: 'AliExpress',
      supplierId: 'demo_sup_ali',
      status: 'SHIPPED',
      orderDate: day(24),
      estimatedDelivery: ahead(6),
      currency: 'EUR',
      totalCost: 3260,
      projectId: 'demo_pr_lamp',
      storageId: 'demo_st_root',
      trackingNumber: 'LP00427391155CN',
      trackingUrl: 'https://t.17track.net/en#nums=LP00427391155CN',
      lastTrackedAt: day(1),
      items: [
        ['demo_it_ws2812', 5, 0, 420],
        ['demo_it_psu5v', 2, 0, 580],
      ] as [string, number, number, number][],
      tracking: [
        {
          status: 'Accepted by carrier',
          location: 'Shenzhen, CN',
          at: day(22),
        },
        {
          status: 'Departed from origin country',
          location: 'Guangzhou, CN',
          at: day(17),
        },
        {
          status: 'Arrived in destination country',
          location: 'Frankfurt, DE',
          at: day(4),
        },
      ],
    },
    {
      id: 'demo_or_delivered',
      storeName: 'Mouser',
      supplierId: 'demo_sup_chip',
      status: 'DELIVERED',
      orderDate: day(76),
      estimatedDelivery: day(70),
      currency: 'EUR',
      totalCost: 2145,
      storageId: 'demo_st_root',
      projectId: 'demo_pr_meteo',
      items: [
        ['demo_it_bme280', 3, 3, 340],
        ['demo_it_d1mini', 3, 3, 280],
        ['demo_it_dupont', 2, 2, 145],
      ] as [string, number, number, number][],
    },
    {
      id: 'demo_or_partial',
      storeName: 'AliExpress',
      supplierId: 'demo_sup_ali',
      status: 'DELIVERED',
      orderDate: day(48),
      estimatedDelivery: day(31),
      currency: 'EUR',
      totalCost: 1420,
      storageId: 'demo_st_root',
      items: [
        ['demo_it_m3insert', 100, 100, 4.2],
        ['demo_it_m3x10', 100, 40, 3.1],
        ['demo_it_shrink', 5, 0, 55],
      ] as [string, number, number, number][],
    },
  ];

  let ocSeq = 0;
  let teSeq = 0;
  let smSeq = 0;
  for (const o of orders) {
    await prisma.order.create({
      data: {
        id: o.id,
        storeName: o.storeName,
        supplierId: o.supplierId,
        status: o.status,
        orderDate: o.orderDate,
        estimatedDelivery: o.estimatedDelivery ?? null,
        trackingNumber: o.trackingNumber ?? null,
        trackingUrl: o.trackingUrl ?? null,
        lastTrackedAt: o.lastTrackedAt ?? null,
        totalCost: o.totalCost ?? null,
        currency: o.currency,
        projectId: o.projectId ?? null,
        storageId: o.storageId ?? null,
        scopeId,
      },
    });
    for (const [componentId, quantity, receivedQty, unitPrice] of o.items) {
      await prisma.orderComponent.create({
        data: {
          id: `demo_oc_${++ocSeq}`,
          orderId: o.id,
          componentId,
          quantity,
          receivedQty,
          unitPrice,
        },
      });
      if (receivedQty > 0) {
        await prisma.stockMovement.create({
          data: {
            id: `demo_sm_${++smSeq}`,
            componentId,
            delta: receivedQty,
            type: 'PURCHASE',
            orderId: o.id,
            note: `Received order from ${o.storeName}`,
            scopeId,
            createdAt: o.estimatedDelivery ?? o.orderDate,
          },
        });
      }
    }
    for (const ev of o.tracking ?? []) {
      await prisma.trackingEvent.create({
        data: {
          id: `demo_te_${++teSeq}`,
          orderId: o.id,
          status: ev.status,
          location: ev.location,
          eventTime: ev.at,
          createdAt: ev.at,
        },
      });
    }
  }

  // ── Consumption history, so the stock charts have a shape ─────────────────
  const consumption: [string, number, number, string, string | null][] = [
    ['demo_it_r220', -12, 132, 'USED', 'demo_pr_shelf'],
    ['demo_it_r1k', -20, 120, 'USED', 'demo_pr_shelf'],
    ['demo_it_m3insert', -12, 118, 'USED', 'demo_pr_shelf'],
    ['demo_it_pla', -0.4, 110, 'USED', 'demo_pr_shelf'],
    ['demo_it_solder', -0.05, 104, 'USED', null],
    ['demo_it_c100n', -10, 88, 'USED', 'demo_pr_meteo'],
    ['demo_it_mgtf', -2, 84, 'USED', 'demo_pr_meteo'],
    ['demo_it_dupont', -10, 66, 'USED', 'demo_pr_meteo'],
    ['demo_it_r10k', -18, 52, 'USED', 'demo_pr_lamp'],
    ['demo_it_ws2812', -3, 44, 'USED', 'demo_pr_lamp'],
    ['demo_it_m3x10', -30, 38, 'USED', 'demo_pr_lamp'],
    ['demo_it_petg', -0.3, 30, 'USED', 'demo_pr_lamp'],
    ['demo_it_shrink', -1.5, 27, 'USED', null],
    ['demo_it_solder', -0.08, 19, 'USED', 'demo_pr_lamp'],
    ['demo_it_pla', -0.6, 12, 'USED', 'demo_pr_bench'],
    ['demo_it_r10k', 6, 40, 'ADJUSTMENT', null],
    ['demo_it_m3nut', -18, 35, 'USED', 'demo_pr_shelf'],
    ['demo_it_flux', -1, 25, 'USED', null],
    ['demo_it_c10u', -6, 15, 'USED', 'demo_pr_lamp'],
    ['demo_it_pir', -1, 100, 'USED', 'demo_pr_shelf'],
  ];
  for (const [componentId, delta, daysAgo, type, projectId] of consumption) {
    await prisma.stockMovement.create({
      data: {
        id: `demo_sm_${++smSeq}`,
        componentId,
        delta,
        type,
        projectId,
        note: type === 'ADJUSTMENT' ? 'Shelf recount' : 'Consumed in build',
        scopeId,
        createdAt: day(daysAgo, 15),
      },
    });
  }

  // ── Task ↔ item / task ↔ order links ─────────────────────────────────────
  await prisma.taskComponent.create({
    data: {
      id: 'demo_tc_1',
      taskId: taskIds['demo_pr_lamp'][2],
      componentId: 'demo_it_psu5v',
      quantity: 1,
      isDone: false,
    },
  });
  await prisma.taskComponent.create({
    data: {
      id: 'demo_tc_2',
      taskId: taskIds['demo_pr_lamp'][3],
      componentId: 'demo_it_petg',
      quantity: 1,
      isDone: false,
    },
  });
  await prisma.taskComponent.create({
    data: {
      id: 'demo_tc_3',
      taskId: taskIds['demo_pr_meteo'][1],
      componentId: 'demo_it_bme280',
      quantity: 1,
      isDone: true,
    },
  });
  await prisma.taskOrderDependency.create({
    data: {
      id: 'demo_td_1',
      taskId: taskIds['demo_pr_lamp'][2],
      orderId: 'demo_or_shipped',
      isDone: false,
    },
  });
  await prisma.taskOrderDependency.create({
    data: {
      id: 'demo_td_2',
      taskId: taskIds['demo_pr_aqua'][0],
      orderId: 'demo_or_cart',
      isDone: false,
    },
  });

  // A tail of rows dated inside the last week, so the "recent activity"
  // surfaces (dashboard, heatmap tail, stock history) are not empty on day one.
  const recent: [string, number, number, string, string | null][] = [
    ['demo_it_ws2812', -1.5, 6, 'USED', 'demo_pr_lamp'],
    ['demo_it_dupont', -8, 5, 'USED', 'demo_pr_aqua'],
    ['demo_it_petg', -0.2, 3, 'USED', 'demo_pr_lamp'],
    ['demo_it_m3x16', -6, 2, 'USED', 'demo_pr_lamp'],
    ['demo_it_c10u', 4, 1, 'ADJUSTMENT', null],
  ];
  for (const [componentId, delta, daysAgo, type, projectId] of recent) {
    await prisma.stockMovement.create({
      data: {
        id: `demo_sm_${++smSeq}`,
        componentId,
        delta,
        type,
        projectId,
        note: type === 'ADJUSTMENT' ? 'Shelf recount' : 'Consumed in build',
        scopeId,
        createdAt: day(daysAgo, 11),
      },
    });
  }
  const recentActivity: [string, string, number][] = [
    ['demo_pr_lamp', 'board_moved', 7],
    ['demo_pr_lamp', 'task_completed', 5],
    ['demo_pr_aqua', 'status_changed', 4],
    ['demo_pr_meteo', 'task_completed', 2],
    ['demo_pr_bench', 'status_changed', 1],
  ];
  for (const [projectId, kind, daysAgo] of recentActivity) {
    await prisma.activityEvent.create({
      data: {
        id: `demo_ae_${++actSeq}`,
        projectId,
        kind,
        scopeId,
        createdAt: day(daysAgo, 17),
      },
    });
  }

  const counts = {
    categories: categories.length,
    properties: properties.length,
    items: items.length,
    storages: 4,
    projects: projects.length,
    tasks: taskSeq,
    orders: orders.length,
    orderLines: ocSeq,
    movements: smSeq,
    tags: tags.length,
    tagLinks: tagLinkSeq,
    activity: actSeq,
  };
  return counts;
}
