import { fetchCobissRecord } from '../shared/cobiss/cobiss-fetch';

async function main() {
  const cobissId = process.argv[2];
  if (!cobissId) {
    console.error('Usage: fetch-cobiss <COBISS_ID>');
    process.exit(1);
  }

  const result = await fetchCobissRecord(cobissId);

  if (!result) {
    console.error('No record found');
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
