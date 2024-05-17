const express = require('express')
const { Transaction } = require("../models/transaction")
const { User } = require("../models/user")
const { default: mongoose } = require('mongoose')
const { tradeAlertMail } = require('../utils/mailer')

const router  = express.Router()

router.get('/', async (req, res) => {
  try {
    const trades = await Transaction.find({ type: 'trade' }).sort({ date: 'asc' });
    res.send(trades);
  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: "Something Went Wrong..." });
  }
});




// creating a trade
router.post('/', async (req, res) => {
  const { package, interest } = req.body;
  
  try {
    // Create a new trade
    const trade = new Transaction({ 
      tradeData: { package, interest },
      type: "trade",
      amount: 0,
    });

    await trade.save();

    // Get all users and extract their email addresses
    const users = await User.find({});
    const emails = users.map(user => user.email);

    // Send trade alert emails
    await tradeAlertMail(package, interest, emails);

    res.status(200).send({ message: 'Success' });
  } catch (error) {
    console.error(error);
    for (const i in error.errors) {
      res.status(500).send({ message: error.errors[i].message });
    }
  }
});


// updating a trade
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const trade = await Transaction.findById(id).session(session);
    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).send({ message: 'Trade not found' });
    }

    // Check and update user balances
    const users = await User.find({ deposit: { $gt: 0 } }).session(session);
    
    for (const user of users) {
      const calculatedInterest = trade.tradeData.interest * user.deposit;
      user.interest += calculatedInterest;
      await user.save({ session });
    }

    // Delete trade after processing
    await trade.remove({ session });
    
    await session.commitTransaction();
    session.endSession();

    res.send({ message: "Trade successfully processed and deleted" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});


// deleting a trade
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const trade = await Transaction.findByIdAndRemove(id);
    if (!trade) return res.status(404).send({message: 'Trade not found'});

    res.send(trade);
  } catch (error) { for (i in error.errors) res.status(500).send({message: error.errors[i].message}) }
})



module.exports = router