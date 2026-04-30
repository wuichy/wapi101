#!/usr/bin/env node
const kommo = require('../lib/kommo');

function line(label, value) {
  console.log(`${label.padEnd(28)} ${value}`);
}

async function main() {
  console.log('\n== Reelance Hub WC-Kommo · descubrir IDs ==\n');

  try {
    const account = await kommo.apiRequest('get', '/api/v4/account');
    line('Cuenta:', `${account.name} (${account.subdomain || ''})`);
  } catch (error) {
    console.error('No pude leer /api/v4/account. ¿Está conectada la cuenta por OAuth?');
    console.error('Mensaje:', error.message);
    process.exit(1);
  }

  console.log('\n--- Pipelines ---');
  const pipelines = await kommo.apiRequest('get', '/api/v4/leads/pipelines');
  const items = pipelines?._embedded?.pipelines || [];
  for (const pipe of items) {
    console.log(`\nPipeline: "${pipe.name}"  id=${pipe.id}`);
    const statuses = pipe?._embedded?.statuses || [];
    for (const status of statuses) {
      console.log(`  - "${status.name}"  status_id=${status.id}`);
    }
  }

  console.log('\n--- Custom fields de Lead ---');
  try {
    const fields = await kommo.apiRequest('get', '/api/v4/leads/custom_fields?limit=250');
    const list = fields?._embedded?.custom_fields || [];
    for (const f of list) {
      const isUltimaCompra = /ultima\s*compra/i.test(String(f.name || ''));
      const marker = isUltimaCompra ? '  ← usa este id en KOMMO_FIELD_LAST_ORDER_DATE' : '';
      console.log(`  id=${f.id}  code=${f.code || '-'}  type=${f.type}  name="${f.name}"${marker}`);
    }
  } catch (error) {
    console.error('Error listando custom fields de leads:', error.message);
  }

  console.log('\n--- Custom fields de Contacto ---');
  try {
    const fields = await kommo.apiRequest('get', '/api/v4/contacts/custom_fields?limit=250');
    const list = fields?._embedded?.custom_fields || [];
    for (const f of list) {
      console.log(`  id=${f.id}  code=${f.code || '-'}  type=${f.type}  name="${f.name}"`);
    }
  } catch (error) {
    console.error('Error listando custom fields de contactos:', error.message);
  }

  console.log('\nCopia los IDs que necesitas a tu .env:');
  console.log('  KOMMO_PIPELINE_CLIENTES_ID=...');
  console.log('  KOMMO_STATUS_RECIENTES_ID=...');
  console.log('  KOMMO_FIELD_LAST_ORDER_NUMBER=...');
  console.log('  KOMMO_FIELD_LAST_ORDER_DATE=...');
  console.log('  KOMMO_FIELD_LAST_ORDER_TOTAL=...');
  console.log('  KOMMO_FIELD_LAST_ORDER_ITEMS=...');
  console.log('  KOMMO_FIELD_LAST_ORDER_STATUS=...');
  console.log();
}

main().catch((error) => {
  console.error('Falló discover:', error.message);
  if (error?.response?.data) {
    console.error('Respuesta Kommo:', JSON.stringify(error.response.data, null, 2));
  }
  process.exit(1);
});
