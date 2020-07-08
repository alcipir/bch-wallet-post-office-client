import React, { useState, useEffect } from 'react';
import axios from 'axios';
import BigNumber from "bignumber.js";
import { getWalletInfo } from './localWallet';
import MinimalBCHWallet from 'minimal-slp-wallet';
import BCHJS from '@chris.troutner/bch-js';
const slpMdm = require('slp-mdm');

const handlePostageRateSubmit = async (postOfficeUrl, setPostageRate) => {
    try {
        const response = await axios.get(`${postOfficeUrl}`, { headers: {
            "Content-Type": "application/simpleledger-payment",
        }});
        setPostageRate(response.data);
    } catch(e) {
        console.error("Error getting postage rate: ", e.message);
    }
}

const setTokenListFromWallet = async (walletInfo, setTokenList) => {
    const minimalBCHWallet = new MinimalBCHWallet(walletInfo.mnemonic);
    const tokenList = await minimalBCHWallet.listTokens(walletInfo.slpAddress);
    console.log(tokenList);
    setTokenList(tokenList);
}

// const generateCustomSendOpReturn = (tokenUtxos, sendQty, postageRate, postageDecimals) => {
//     try {
//         const tokenId = tokenUtxos[0].tokenId
//         const decimals = tokenUtxos[0].decimals
  
//         // Calculate the total amount of tokens owned by the wallet.
//         let totalTokens = 0
//         for (let i = 0; i < tokenUtxos.length; i++)
//           totalTokens += tokenUtxos[i].tokenQty
  
//         const change = totalTokens - sendQty
//         // console.log(`change: ${change}`)
  
//         let script
//         let outputs = 2
  
//         // The normal case, when there is token change to return to sender.
//         if (change > 0) {
//           outputs = 3
  
//           // Convert the send quantity to the format expected by slp-mdm.
//           let baseQty = new BigNumber(sendQty).times(10 ** decimals)
//           baseQty = baseQty.absoluteValue()
//           baseQty = Math.floor(baseQty)
//           baseQty = baseQty.toString()
//           // console.log(`baseQty: `, baseQty)
  
//           // Convert the  postage rate to the format expected by slp-mdm.
//           let basePostage = new BigNumber(postageRate).times(10 ** postageDecimals)
//           basePostage = basePostage.absoluteValue()
//           basePostage = Math.floor(basePostage)
//           basePostage = basePostage.toString()

//           // Convert the change quantity to the format expected by slp-mdm.
//           let baseChange = new BigNumber(change).times(10 ** decimals)
//           baseChange = baseChange.absoluteValue()
//           baseChange = Math.floor(baseChange)
//           baseChange = baseChange.toString()
//           // console.log(`baseChange: `, baseChange)
  
//           // Generate the OP_RETURN as a Buffer.
//           script = slpMdm.TokenType1.send(tokenId, [
//             new slpMdm.BN(baseQty),
//             new slpMdm.BN(basePostage),
//             new slpMdm.BN(baseChange)
//           ])
//           //
  
//           // Corner case, when there is no token change to send back.
//         } else {
//             let baseQty = new BigNumber(sendQty).times(10 ** decimals)
//             baseQty = baseQty.absoluteValue()
//             baseQty = Math.floor(baseQty)
//             baseQty = baseQty.toString()
//             // console.log(`baseQty: `, baseQty)

//             // Convert the  postage rate to the format expected by slp-mdm.
//             let basePostage = new BigNumber(postageRate).times(10 ** postageDecimals)
//             basePostage = basePostage.absoluteValue()
//             basePostage = Math.floor(basePostage)
//             basePostage = basePostage.toString()
  
//             // console.log(`baseQty: ${baseQty.toString()}`)
    
//             // Generate the OP_RETURN as a Buffer.
//             script = slpMdm.TokenType1.send(tokenId, [new slpMdm.BN(baseQty), new slpMdm.BN(basePostage)])
//         }
    
//         return { script, outputs }
//       } catch (err) {
//         console.log(`Error in generateSendOpReturn()`)
//         throw err
//       }
// }

const sendTransaction = async (postOfficeUrl, postageData, walletInfo, tokenId, amount, outputAddress) => {
    try {
        //const minimalBCHWallet = await new MinimalBCHWallet(walletInfo.mnemonic);
        console.log(`Creating custom transaction for Post Office...`);
        const bchjs = await new BCHJS({
            restURL: 'https://api.fullstack.cash/v3/',
            apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjVmMDRmNDQ3ZjZkMmNkMDAxMjZiNzUyOSIsImVtYWlsIjoiYW5kcmVjYWJyZXJhQHByb3Rvbm1haWwuY2giLCJhcGlMZXZlbCI6MCwicmF0ZUxpbWl0IjozLCJpYXQiOjE1OTQxNjAyMjEsImV4cCI6MTU5Njc1MjIyMX0.L-h_hdVMjMafSaVHsXLeoyISLvwezZXji04G9KRvKD0' // Your JWT token here.
          })
        const utxoResponse = await bchjs.Electrumx.utxo(walletInfo.cashAddress);
        const slpUtxos = await bchjs.SLP.Utils.tokenUtxoDetails(utxoResponse.utxos);
        console.log(`SLP UTXOS`, slpUtxos);
        console.log(`Token ID`, tokenId);
        const slpUtxosFromTokenId = slpUtxos.filter(slpUtxo => slpUtxo.tokenId === tokenId); // && slpUtxo.tokenQty > amount
        const transactionBuilder = new bchjs.TransactionBuilder();
        console.log(`Adding SLP inputs`);
        slpUtxosFromTokenId.map(slpUtxo => transactionBuilder.addInput(slpUtxo.tx_hash, slpUtxo.tx_pos));
        console.log(`Add SLP outputs`);
        
        
        const slpSendOpReturn = bchjs.SLP.TokenType1.generateSendOpReturn(
            slpUtxosFromTokenId,
            amount
        );

        console.log(`SLP_SEND_OP_RETURN`, slpSendOpReturn);
        transactionBuilder.addOutput(slpSendOpReturn.script, 0);
        
       // Send dust transaction representing tokens being sent.
       transactionBuilder.addOutput(
           bchjs.SLP.Address.toLegacyAddress(outputAddress),
           546
       )

       if (postageData.rate > 0) {
        transactionBuilder.addOutput(
            bchjs.SLP.Address.toLegacyAddress(postageData.address),
            546
        )
       }

      // Return any token change back to the sender.
      if (slpSendOpReturn.outputs > 1) {
        transactionBuilder.addOutput(
          bchjs.SLP.Address.toLegacyAddress(walletInfo.address),
          546
        )
      }

    } catch (e) {
        console.error(`Error from FullStack.cash api`, e);
    }
}

const PostOffice = () => {
    const [postageData, setPostageData] = useState(null);
    const [postOfficeUrl, setPostOfficeUrl] = useState("http://localhost:3000/postage");
    const [tokenList, setTokenList] = useState([]);
    const [selectedTokenId, setSelectedTokenId] = useState(null)
    const [amount, setAmount] = useState(0);
    const [slpDestinationAddress, setSlpDestinationAddress] = useState(null)

    
    useEffect(() => {
        const walletInfo = getWalletInfo();
        setTokenListFromWallet(walletInfo, setTokenList);
    }, [])

    return (<div>
        <h2>Send Transactions through a Post Office</h2>
        <div><form>
            <h3>Post Office Url</h3>
            <input type="text" value={postOfficeUrl} onChange={(e) => setPostOfficeUrl(e.target.value)} />
            <button onClick={() => handlePostageRateSubmit(postOfficeUrl, setPostageData)}>Get Postage Rate</button>
            </form>
            {postageData && <ul>
                <li>Rate: {(new BigNumber(postageData.stamps[0].rate, 16) / Math.pow(10, postageData.stamps[0].decimals)).toFixed(postageData.stamps[0].decimals)} {postageData.stamps[0].symbol}</li>
            </ul>}
        </div>
        <div>
            <h3>Choose Token to Send</h3>
            <form action="">
                {postageData && <select onChange={(e) => setSelectedTokenId(e.target.value)}>
                    {tokenList.filter(token => postageData.stamps.map(stamp => stamp.tokenId).includes(token.tokenId)).map(token => <option value={token.tokenId}>{token.ticker}</option>)}
                </select>}
            </form>
            <h3>Amount</h3>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}/>
            
            
            <h3>SLP Destination Address</h3>
            <input type="text" value={slpDestinationAddress} onChange={(e) => setSlpDestinationAddress(e.target.value)}/>

            <button onClick={() => sendTransaction(postOfficeUrl, postageData, getWalletInfo(), `9fc89d6b7d5be2eac0b3787c5b8236bca5de641b5bafafc8f450727b63615c11`, amount, slpDestinationAddress)}>Send Transaction</button>

        </div>


    </div>);
}
 
export default PostOffice;