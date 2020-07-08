import React, { useState, useEffect } from 'react';
import axios from 'axios';
import BigNumber from "bignumber.js";
import { getWalletInfo } from './localWallet';
import MinimalBCHWallet from 'minimal-slp-wallet';
import BCHJS from '@chris.troutner/bch-js';
import { Content, Row, Col, Box, Inputs, Button } from "adminlte-2-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
const { Text, Select } = Inputs

const slpjs = require('slpjs');
const PaymentProtocol = require('bitcore-payment-protocol')

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
        const slpInputUtxo = slpUtxosFromTokenId.filter(slpUtxo => slpUtxo.tokenQty > amount).pop();
    
        console.log(`Add SLP outputs`);
        const postageRate = new BigNumber(postageData.stamps[0].rate / (10 ** postageData.stamps[0].decimals)).times(10 ** (slpUtxosFromTokenId[0].decimals));
        const tokenQty = new BigNumber(slpInputUtxo.tokenQty).times(10 ** slpUtxosFromTokenId[0].decimals);
        const amountToSend = new BigNumber(amount).times(10 ** slpUtxosFromTokenId[0].decimals);
        const change = tokenQty.minus(amountToSend).minus(postageRate);
        const outputQtyArray = (change === 0) ? [new BigNumber(amountToSend), new BigNumber(postageRate)] : [new BigNumber(amountToSend), new BigNumber(postageRate), new BigNumber(change)]
        const slpSendOpReturn = slpjs.Slp.buildSendOpReturn(
            { tokenIdHex: tokenId, outputQtyArray: outputQtyArray }
        );

        console.log(`SLP_SEND_OP_RETURN`, slpSendOpReturn);
        transactionBuilder.addOutput(slpSendOpReturn, 0);
        
       // Send dust transaction representing tokens being sent.
       transactionBuilder.addOutput(
           bchjs.SLP.Address.toLegacyAddress(outputAddress),
           546
       )

       if (postageData.stamps[0].rate > 0) {
        transactionBuilder.addOutput(
            bchjs.SLP.Address.toLegacyAddress(postageData.address),
            546
        )
       }

      // Return any token change back to the sender.
      if (!change.isLessThanOrEqualTo(0)) {
        transactionBuilder.addOutput(
          bchjs.SLP.Address.toLegacyAddress(walletInfo.address),
          546
        )
      }

      console.log(`Signing SLP inputs`);
      transactionBuilder.addInput(slpInputUtxo.tx_hash, slpInputUtxo.tx_pos);
      const seed = await bchjs.Mnemonic.toSeed(walletInfo.mnemonic);
      console.log(`seed`, seed);
      const hdNode = await bchjs.HDNode.fromSeed(seed);
      const bip44BCHAccount = bchjs.HDNode.derivePath(hdNode, "m/44'/245'/0'");
      const changeAddressNode0 = bchjs.HDNode.derivePath(bip44BCHAccount, '0/0');
      console.log(`Address`, bchjs.HDNode.toCashAddress(changeAddressNode0))
      const keyPair = bchjs.HDNode.toKeyPair(changeAddressNode0);
      console.log(`keyPair`, keyPair);
      transactionBuilder.sign(0, keyPair, undefined, transactionBuilder.hashTypes.SIGHASH_ALL | transactionBuilder.hashTypes.SIGHASH_ANYONECANPAY, slpInputUtxo.satoshis,  transactionBuilder.signatureAlgorithms.ECDSA);
      
      const incompleteTx = transactionBuilder.transaction.buildIncomplete();
      console.log(`Incomplete tx: `, incompleteTx);
      
      const payment = new PaymentProtocol().makePayment();
      payment.set('merchant_data', Buffer.from(JSON.stringify(postageData), 'utf-8'));
      payment.set('transactions', [Buffer.from(incompleteTx.toHex(), 'hex')])
      const rawbody = payment.serialize()
      const headers = {
        Accept:
          'application/simpleledger-paymentrequest, application/simpleledger-paymentack',
        'Content-Type': 'application/simpleledger-payment',
        'Content-Transfer-Encoding': 'binary',
      }
      const response = await axios.post(
        postOfficeUrl,
        rawbody,
        {
          headers,
          responseType: 'blob',
        }
      )

     // const responseTxHex = await PaymentProtocol.decodePaymentResponse(response.data)
    // const resultTransaction = bchjs.TransactionBuilder.transaction.fromHex(responseTxHex.hex);
    //  console.log(resultTransaction);
    } catch (e) {
        console.error(`Error from FullStack.cash api`, e);
    }
}

const PostOffice = () => {
    const [postageData, setPostageData] = useState(null);
    const [postOfficeUrl, setPostOfficeUrl] = useState("http://localhost:3000/postage");
    const [tokenList, setTokenList] = useState([]);
    const [selectedTokenId, setSelectedTokenId] = useState("9fc89d6b7d5be2eac0b3787c5b8236bca5de641b5bafafc8f450727b63615c11");
    const [amount, setAmount] = useState(0);
    const [slpDestinationAddress, setSlpDestinationAddress] = useState(null);
    const [transactionId, setTransactionId] = useState(null)

    
    useEffect(() => {
        const walletInfo = getWalletInfo();
        setTokenListFromWallet(walletInfo, setTokenList);
    }, [])

    return (
    <>
    <Content>
        <Row>
            <Col sm={12}>
            <Box className="hover-shadow border-none mt-2">
              <Row>
                <Col sm={12} className="text-center">
                  <h1>
                    <FontAwesomeIcon
                      className="title-icon"
                      size="xs"
                      icon={"envelope"}
                    />
                    <span>Post Office</span>
                  </h1>
                  <Box className="border-none">
                    <Text
                      id="postofficeurl"
                      name="postofficeurl"
                      placeholder="Enter Post Office Url"
                      label="Post Office URL"
                      labelPosition="above"
                      onChange={(e) => setPostOfficeUrl(e.target.value)}
                    />
                    <Button
                      text="Get Postage Rate"
                      type="primary"
                      className="btn-lg"
                      onClick={() => handlePostageRateSubmit(postOfficeUrl, setPostageData)}
                    />
                  </Box>
                </Col>
                <Col sm={12} className="text-center">
                {postageData && <p>Rate: {(new BigNumber(postageData.stamps[0].rate, 16) / Math.pow(10, postageData.stamps[0].decimals)).toFixed(postageData.stamps[0].decimals)} {postageData.stamps[0].symbol}</p>}
                </Col>
              </Row>
            </Box>
          </Col>
        </Row>
        {postageData && <Row>
            <Col sm={12}>
            <Box className="hover-shadow border-none mt-2">
              <Row>
                <Col sm={12} className="text-center">
                  <Box className="border-none">
                    <Text
                      id="slpaddress"
                      name="slpaddress"
                      placeholder="Enter SLP Destination Address"
                      label="SLP Destination Address"
                      labelPosition="above"
                      onChange={(e) => setSlpDestinationAddress(e.target.value)}
                    />
                    <Select name="tokenid" onChange={(e) => { console.log(e); setSelectedTokenId(e.target.value) }}
                            value={selectedTokenId}
                            options={tokenList.filter(token => postageData.stamps.map(stamp => stamp.tokenId).includes(token.tokenId)).map(token => ({ value: token.tokenId, text: token.ticker }))}
                     />
                    <Text
                      id="amount"
                      name="amount"
                      placeholder="Enter Amount"
                      label="Amount"
                      labelPosition="above"
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <Button
                      text="Send Transaction (without paying gas!)"
                      type="primary"
                      className="btn-lg"
                      style={{ marginTop: "15px"}}
                      onClick={() => sendTransaction(postOfficeUrl, postageData, getWalletInfo(), selectedTokenId, amount, slpDestinationAddress, setTransactionId)}
                    />
                  </Box>
                </Col>
                <Col sm={12} className="text-center">
                    {transactionId && (<a href={`https://explorer.bitcoin.com/bch/tx/${transactionId}`}>Transaction successful! Click here to go to the explorer.</a>)}
                </Col>
              </Row>
            </Box>
          </Col>
        </Row>}
      </Content>
    </>);
}
 
export default PostOffice;