import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgrespassword@localhost:5432/diy_inspector?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Clearing database...');
  await prisma.aIChatMessage.deleteMany({});
  await prisma.aIChatSession.deleteMany({});
  await prisma.projectComponent.deleteMany({});
  await prisma.orderComponent.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.component.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.aIProviderConfig.deleteMany({});

  console.log('Seeding Component list...');
  const esp32 = await prisma.component.create({
    data: {
      id: 'comp_esp32',
      name: 'ESP32-WROOM-32D Development Board',
      sku: 'ESP32-DEV-WROOM',
      description: 'Микроконтроллер ESP32 с поддержкой Wi-Fi и Bluetooth',
      category: 'Микросхемы',
      links: JSON.stringify([
        {
          label: 'Datasheet',
          url: 'https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32d_esp32-wroom-32u_datasheet_en.pdf',
        },
      ]),
      quantity: 5,
      minQuantity: 2,
    },
  });

  const dht22 = await prisma.component.create({
    data: {
      id: 'comp_dht22',
      name: 'DHT22 Temperature & Humidity Sensor',
      sku: 'SENS-DHT22-AM2302',
      description: 'Цифровой датчик температуры и влажности высокой точности',
      category: 'Датчики',
      links: JSON.stringify([
        {
          label: 'Datasheet',
          url: 'https://web.archive.org/web/2026/https://www.sparkfun.com/datasheets/Sensors/Temperature/DHT22.pdf',
        },
      ]),
      quantity: 1,
      minQuantity: 2,
    },
  });

  const resistors = await prisma.component.create({
    data: {
      id: 'comp_resistors',
      name: 'Resistors Kit 1/4W 10K Ohm (100 pcs)',
      sku: 'RES-KIT-10K',
      description: 'Выводные резисторы металлопленочные 10 кОм',
      category: 'Резисторы',
      quantity: 100,
      minQuantity: 20,
    },
  });

  const mosfet = await prisma.component.create({
    data: {
      id: 'comp_mosfet',
      name: 'N-Channel Power MOSFET IRLZ44N',
      sku: 'SEMI-IRLZ44N',
      description: 'Logic-Level полевой транзистор для коммутации нагрузок',
      category: 'Транзисторы',
      links: JSON.stringify([
        {
          label: 'Datasheet',
          url: 'https://www.infineon.com/dgdl/Infineon-IRLZ44N-DataSheet-v01_01-EN.pdf?fileId=5546d462533600a4015356ec853c1d42',
        },
      ]),
      quantity: 4,
      minQuantity: 2,
    },
  });

  console.log('Seeding Project configurations...');
  // Every project sits in a group (#286); the seed runs single-user, so the
  // default group's id is the one derived for the NULL scope.
  const defaultGroupId = createHash('md5')
    .update('projectgroup:default:')
    .digest('hex');
  await prisma.projectGroup.upsert({
    where: { id: defaultGroupId },
    update: {},
    create: { id: defaultGroupId, name: 'General', isDefault: true },
  });

  const weatherStation = await prisma.project.create({
    data: {
      id: 'proj_weather',
      title: 'Умная метеостанция на ESP32',
      description:
        'Автономная метеостанция с датчиками DHT22 и BMP280, отправляющая данные в Home Assistant.',
      status: 'IN_PROGRESS',
      groupId: defaultGroupId,
    },
  });

  const nightLight = await prisma.project.create({
    data: {
      id: 'proj_light',
      title: 'Ночник с управлением по Wi-Fi',
      description:
        'Светодиодная лента WS2812B с управлением через веб-интерфейс на базе ESP32.',
      status: 'IDEA',
      groupId: defaultGroupId,
    },
  });

  console.log('Seeding tasks...');
  const tasks = [
    {
      id: 't1',
      projectId: weatherStation.id,
      title: 'Сборка схемы на макетной плате',
      isCompleted: true,
    },
    {
      id: 't2',
      projectId: weatherStation.id,
      title: 'Написание прошивки для ESP32',
      isCompleted: true,
    },
    {
      id: 't3',
      projectId: weatherStation.id,
      title: 'Калибровка датчика DHT22',
      isCompleted: true,
    },
    {
      id: 't4',
      projectId: weatherStation.id,
      title: 'Настройка интеграции с Home Assistant',
      isCompleted: true,
    },
    {
      id: 't5',
      projectId: weatherStation.id,
      title: 'Печать корпуса на 3D-принтере',
      isCompleted: true,
    },
    {
      id: 't6',
      projectId: weatherStation.id,
      title: 'Разводка печатной платы в EasyEDA',
      isCompleted: false,
    },
    {
      id: 't7',
      projectId: weatherStation.id,
      title: 'Финальный монтаж компонентов',
      isCompleted: false,
    },
    {
      id: 't8',
      projectId: weatherStation.id,
      title: 'Тестирование автономной работы',
      isCompleted: false,
    },
  ];

  for (const t of tasks) {
    await prisma.task.create({ data: t });
  }

  console.log('Linking Projects and Components...');
  await prisma.projectComponent.create({
    data: {
      id: 'pc1',
      projectId: weatherStation.id,
      componentId: esp32.id,
      neededQty: 1,
      reservedQty: 1,
    },
  });

  await prisma.projectComponent.create({
    data: {
      id: 'pc2',
      projectId: weatherStation.id,
      componentId: dht22.id,
      neededQty: 1,
      reservedQty: 1,
    },
  });

  await prisma.projectComponent.create({
    data: {
      id: 'pc3',
      projectId: weatherStation.id,
      componentId: resistors.id,
      neededQty: 2,
      reservedQty: 2,
    },
  });

  console.log('Seeding Orders and Deliveries...');
  const orderAli = await prisma.order.create({
    data: {
      id: 'order_ali',
      storeName: 'AliExpress',
      orderDate: new Date('2026-07-01'),
      status: 'SHIPPED',
      trackingNumber: 'AE123456789CN',
      trackingUrl: 'https://global.cainiao.com/',
      estimatedDelivery: new Date('2026-07-20'),
      totalCost: 12.5,
    },
  });

  const orderAmperka = await prisma.order.create({
    data: {
      id: 'order_amp',
      storeName: 'Amperka',
      orderDate: new Date('2026-06-15'),
      status: 'DELIVERED',
      trackingNumber: 'AMP987654',
      trackingUrl: 'https://amperka.ru/',
      estimatedDelivery: new Date('2026-06-20'),
      totalCost: 24.99,
    },
  });

  await prisma.orderComponent.create({
    data: {
      id: 'oc1',
      orderId: orderAli.id,
      componentId: dht22.id,
      quantity: 3,
      unitPrice: 2.5,
    },
  });

  await prisma.orderComponent.create({
    data: {
      id: 'oc2',
      orderId: orderAmperka.id,
      componentId: resistors.id,
      quantity: 1,
      unitPrice: 10.0,
    },
  });

  console.log('Seeding default AI Provider Config...');
  await prisma.aIProviderConfig.create({
    data: {
      id: 'prov_gemini',
      name: 'Мой Gemini Аккаунт',
      provider: 'gemini',
      apiKey: 'AIzaSyD...',
      baseUrl: 'https://generativelanguage.googleapis.com',
      modelName: 'gemini-1.5-flash',
      isDefault: true,
    },
  });

  await prisma.aIProviderConfig.create({
    data: {
      id: 'prov_ollama',
      name: 'Локальная модель Ollama',
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      modelName: 'llama3:8b',
      isDefault: false,
    },
  });

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
