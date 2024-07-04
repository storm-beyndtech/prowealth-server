const express = require("express");
const { Transaction } = require("../models/transaction");
const { User } = require("../models/user");
const { default: mongoose } = require("mongoose");
const { tradeAlertMail } = require("../utils/mailer");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const trades = await Transaction.find({ type: "trade" }).sort({
      date: "asc",
    });
    res.send(trades);
  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: "Something Went Wrong..." });
  }
});

// New route to get active trades for a particular user
router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const activeTrades = await Transaction.find({
      type: "trade",
      status: "pending",
      "user.id": userId,
    }).sort({ date: "asc" });
    res.send(activeTrades);
  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: "Something Went Wrong..." });
  }
});

// creating a trade
router.post("/user/:userId", async (req, res) => {
  const { package, interest, amount } = req.body;
  const userId = req.params.userId;

  // Start a session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(400).send({ message: "Something went wrong" });
    }

    // Check if the user has enough deposit
    if (user.deposit < amount) {
      await session.abortTransaction();
      return res.status(400).send({ message: "Insufficient deposit" });
    }

    // Create a new trade
    const trade = new Transaction({
      user: { id: userId, name: user.fullName, email: user.email },
      tradeData: { package, interest },
      type: "trade",
      amount,
    });

    await trade.save({ session });

    // Subtract the trade amount from the user's deposit
    user.deposit -= amount;

    // Save the updated user
    await user.save({ session });

    // Commit the transaction
    await session.commitTransaction();

    // Send trade email
    await tradeAlertMail(package, amount, user.email);

    res.status(200).send({ message: "Success" });
  } catch (error) {
    console.error(error);
    await session.abortTransaction();
    res
      .status(500)
      .send({ message: "Internal Server Error", details: error.message });
  } finally {
    // End the session
    session.endSession();
  }
});

// updating a trade
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const trade = await Transaction.findById(id).session(session);
    if (!trade) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).send({ message: "Trade not found" });
    }

    // Check for user
    let user = await User.findById(trade.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(400).send({ message: "Something went wrong" });
    }

    const roi = (trade.tradeData.interest * trade.amount) + trade.amount;
    user.interest += roi;
    await user.save({ session });

    // Delete trade after processing
    await trade.remove({ session });

    await session.commitTransaction();
    session.endSession();

    res.send({ message: "Trade successfully processed and deleted" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

// deleting a trade
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const trade = await Transaction.findByIdAndRemove(id);
    if (!trade) return res.status(404).send({ message: "Trade not found" });

    res.send(trade);
  } catch (error) {
    for (i in error.errors)
      res.status(500).send({ message: error.errors[i].message });
  }
});

module.exports = router;
