import Database from 'better-sqlite3';

const db = new Database('logs/orderbook.db');
const latest: any = db.prepare('SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1').get();

if (latest) {
  console.log('--- LATEST SNAPSHOT ---');
  console.log(`Pair: ${latest.pair}`);
  console.log(`Bid: ${latest.bid} / Ask: ${latest.ask}`);
  console.log(`Oracle: ${latest.oracle} / Dev: ${latest.deviation}%`);
  console.log(`Imbalance: ${latest.imbalance}`);
  
  const bids = JSON.parse(latest.bids_json || '[]');
  const asks = JSON.parse(latest.asks_json || '[]');
  
  console.log('\nTop 3 Bids:');
  bids.slice(0, 3).forEach((b: any) => console.log(`  ${b.price} x ${b.qty}`));
  
  console.log('\nTop 3 Asks:');
  asks.slice(0, 3).forEach((a: any) => console.log(`  ${a.price} x ${a.qty}`));
} else {
  console.log('No snapshots found in DB yet.');
}
db.close();
