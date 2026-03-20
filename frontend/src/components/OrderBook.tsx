import React, { useState, useEffect } from 'react';

interface OrderBookProps {
  pair: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export const OrderBook: React.FC<OrderBookProps> = ({ pair, bids, asks }) => {
  return (
    <div className="orderbook">
      <h2>Order Book - {pair}</h2>
      <div className="orderbook-grid">
        <div className="side asks">
          <h3>Asks (Sell Orders)</h3>
          <table>
            <thead>
              <tr>
                <th>Price (sats)</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {asks.map((ask, idx) => (
                <tr key={idx}>
                  <td className="price">{ask[0].toLocaleString()}</td>
                  <td className="quantity">{ask[1].toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="side bids">
          <h3>Bids (Buy Orders)</h3>
          <table>
            <thead>
              <tr>
                <th>Price (sats)</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((bid, idx) => (
                <tr key={idx}>
                  <td className="price">{bid[0].toLocaleString()}</td>
                  <td className="quantity">{bid[1].toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
