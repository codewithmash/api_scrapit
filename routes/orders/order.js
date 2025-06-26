const express = require('express');
const router = express.Router();
const admin = require('../../firebase1');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const app = express();

app.use(bodyParser.json());

// 1. Enhanced Order Creation Endpoint
router.post("/create_order", async (req, res) => {
  console.log("Starting order creation process");
  try {
    const { 
      userId, 
      items, 
      isRecurring, 
      reminderEnabled,
      pickupDate,
      pickupAddress,
      pickupAddressType,
      pickupAddressPersonName,
      notes,
      nextRecurringDate
      // binImages,
      // binNotes
    } = req.body;

    console.log("Received data:", req.body);

    // Validation
    if (!userId || !items || !Array.isArray(items)) {
      console.error("Missing required fields for order creation");
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["userId", "items (non-empty array)"],
        received: {
          userId: !!userId,
          items: items?.length || 0
        }
      });
    }
    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Items array cannot be empty"
      });
    }
    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.error(`User not found: ${userId}`);
      return res.status(404).json({
        success: false,
        error: "User not found",
        userId
      });
    }

    // Generate pickup ID
    const pickupId = `#${Math.floor(100000 + Math.random() * 900000)}`;
    const timestamp = admin.firestore.Timestamp.now();
    const pickupTimestamp = pickupDate 
      ? admin.firestore.Timestamp.fromDate(new Date(pickupDate))
      : null;

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => {
      return sum + (parseFloat(item.scrapType.quantity) * parseFloat(item.scrapType.ratePerKg));
    }, 0);

    // Create order document
    const orderData = {
      orderId: `order_${uuidv4()}`,
      pickupId,
      userId,
      collectorId: null,
      items: items.map(item => ({
        scrapItemID: item.scrapItemID,
        scrapType: {
          id: item.scrapType.id,
          name: item.scrapType.name,
          ratePerKg: parseFloat(item.scrapType.ratePerKg),
          category:item.scrapType.category,
          quantity : item.scrapType.quantity,
          unit  :  item.scrapType.unit,
          scrapImage :  item.scrapType.scrapImage
        },
        status: item.status || "fn_bin" // Preserve status from bin
      })),
      status: "pending",
      statusTimeline: {
        created: timestamp,
        scheduled: null,
        confirmed: null,
        outForPickup: null,
        completed: null,
        paymentProcessed: null
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      pickupDate: pickupTimestamp,
      pickupAddress: pickupAddress || userDoc.data().address || "Not specified",
      pickupAddressPersonName,
      pickupAddressType,
      notes: notes || "",
      isRecurring: Boolean(isRecurring),
      reminderEnabled: Boolean(reminderEnabled),
      paymentStatus: "pending",// pending, scheduled, approved, paymentProcessed, outForDelivery
      totalAmount: totalAmount,
      preparationInstructions: "Please ensure all items are properly packed and ready for pickup",
      rejectedReason : "",
      user_cancelled :  false,
      user_cancelled_reason :  null,
      user_cancelled_data : null,
      nextRecurringDate
    };

    // Start Firestore batch write
    const batch = db.batch();
    
    // Create order
    const orderRef = db.collection("orders").doc(orderData.orderId);
    batch.set(orderRef, orderData);

    // Empty the user's bin by updating each item's status
    const binItemsRef = db.collection("bins").doc(userId).collection("items");
    const binItemsSnapshot = await binItemsRef.get();
    
    binItemsSnapshot.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: "order_created",
        updatedAt: timestamp
      });
    });

 batch.update(userRef, {
      bin: [], 
      lastOrderDate: admin.firestore.FieldValue.serverTimestamp()
    });
  
    // batch.update(userRef, {
    //   totalScrapped: admin.firestore.FieldValue.increment(
    //     items.reduce((sum, item) => sum + parseFloat(item.quantity), 0)
    //   ),
    //   walletAmount: admin.firestore.FieldValue.increment(totalAmount),
    //   lastOrderDate: timestamp
    // });

    await batch.commit();
    console.log(`Successfully created order ${orderData.orderId} and updated bin items`);
    return res.status(201).json({
      success: true,
      message: "Order created successfully and bin items updated",
      pickupId: orderData.pickupId,
      orderData: {
        ...orderData,
        createdAt: orderData.createdAt.toDate(),
        updatedAt: orderData.updatedAt.toDate(),
        pickupDate: orderData.pickupDate?.toDate()
      }
    });

  } catch (e) {
    console.error("Critical error in order creation:", e);
    return res.status(500).json({
      success: false,
      error: "Failed to create order",
      message: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

router.post("/approve_order", async (req, res) => {
  try {
    const { orderId, collectorId } = req.body;

    if (!orderId || !collectorId) {
      return res.status(400).json({ 
        success: false,
        error: "Missing orderId or collectorId" 
      });
    }
    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(orderId);
    const timestamp = admin.firestore.Timestamp.now();

    // First get the order details
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Order not found"
      });
    }
    const orderData = orderDoc.data();
    // Update the original order
    await orderRef.update({
      status: "scheduled",
      collectorId,
      "statusTimeline.scheduled": timestamp,
      updatedAt: timestamp
    });

    const updatedOrder = await orderRef.get();
    const updatedOrderData = updatedOrder.data();
  
    // Create a record in the partners_orders collection
    const partnerOrderRef = db.collection("partners_orders").doc();


    await partnerOrderRef.set({
      orderId,
      collectorId,
      originalOrderData: updatedOrderData, // Store the complete order data
      status: "scheduled",
      weight_scrap: "",
      scrap_image : "",
      additional_notes : "",
      pickup_weight : "",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    res.status(200).json({
      success: true,
      message: "Order approved and scheduled",
      orderId,
      partnerOrderId: partnerOrderRef.id
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      error: "Failed to approve order",
      message: e.message
    });
  }
});

router.post("/reject_order", async (req, res) => {
  try {
    const { orderId, rejectedReason } = req.body;

    if (!orderId || !rejectedReason) {
      return res.status(400).json({ 
        success: false,
        error: "Missing orderId or rejectionReason" 
      });
    }

    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(orderId);
    const timestamp = admin.firestore.Timestamp.now();

    // First get the order details
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Order not found"
      });
    }

    const orderData = orderDoc.data();

    // Update the original order
    await orderRef.update({
      status: "rejected",
      rejectedReason,
      "statusTimeline.rejected": timestamp,
      updatedAt: timestamp
    });

    // Create a record in the rejected_orders collection
    const rejectedOrderRef = db.collection("rejected_orders").doc();
    await rejectedOrderRef.set({
      orderId,
      originalOrderData: orderData,
      rejectedReason,
      status: "rejected",
      rejectedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    res.status(200).json({
      success: true,
      message: "Order rejected successfully",
      orderId,
      rejectedOrderId: rejectedOrderRef.id
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      error: "Failed to reject order",
      message: e.message
    });
  }
});

// 3. Order Status Update Endpoint (for all status changes)
router.post("/update_order_status_time_line", async (req, res) => {
  try {
    const { orderId, status } = req.body;
    const validStatuses = ["scheduled", "confirmed", "outForPickup", "paymentProcessed"];
    
    if (!orderId || !status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid status update request" 
      });
    }

    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(orderId);
    const timestamp = admin.firestore.Timestamp.now();
    const updateData = {
      updatedAt: timestamp,
      [`statusTimeline.${status}`]: timestamp
    };

    await orderRef.update(updateData);

    res.status(200).json({
      success: true,
      message: `Order status updated to ${status}`,
      orderId
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      error: "Failed to update order status",
      message: e.message
    });
  }
});

// 4. Get Order Details Endpoint (for the Track Pickup screen)
router.get("/order/:pickupId", async (req, res) => {
  try {
    const { pickupId } = req.params;
    
    const db = admin.firestore();
    const snapshot = await db.collection("orders")
      .where("pickupId", "==", pickupId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ 
        success: false,
        error: "Order not found" 
      });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();

    // Format response to match UI needs
    const response = {
      pickupId: orderData.pickupId,
      items: orderData.items.map(item => ({
        name: item.scrapType.name,
        notes: item.notes,
        price: item.quantity * item.scrapType.ratePerKg
      })),
      status: orderData.status,
      statusTimeline: orderData.statusTimeline,
      collector: orderData.collectorId ? await getCollectorDetails(orderData.collectorId) : null,
      preparationInstructions: orderData.preparationInstructions,
      actions: [
        { id: "editAddress", label: "Edit Address", completed: false },
        { id: "chat", label: "Chat With Us", completed: true },
        { id: "reschedule", label: "Reschedule", completed: false },
        { id: "cancel", label: "Cancel Pickup", completed: false }
      ]
    };

    res.status(200).json({
      success: true,
      order: response
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch order details",
      message: e.message
    });
  }
});

// Helper function to get collector details
async function getCollectorDetails(collectorId) {


  var collectorDoc;
  if(collectorId!=null){
  const db = admin.firestore();
  collectorDoc = await db.collection("partners").doc(collectorId).get();
}
else{
  return null;
}
  if (!collectorDoc.exists) {
    return null;
  }

  const collectorData = collectorDoc.data();
  return {
    name: collectorData.fullName,
    phone: collectorData.phoneNumber,
    profileImage: collectorData.documents["profilePhoto"]
  };
}

// Get all the orders
router.get("/orders", async (req, res, next) => {
  try {
    console.log("Fetching all orders");
    const db = admin.firestore();
    const ordersRef = db.collection("orders");
    const snapshot = await ordersRef.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        message: "No orders found",
        orders: []
      });
    }

    const orders = [];
    snapshot.forEach(doc => {
      const orderData = doc.data();
      // Convert Firestore Timestamps to JavaScript Dates
      orders.push({
        id: doc.id,
        ...orderData,
        createdAt: orderData.createdAt.toDate(),
        updatedAt: orderData.updatedAt?.toDate(),
        pickupDate: orderData.pickupDate?.toDate(),
        statusTimeline: {
          created: orderData.statusTimeline.created.toDate(),
          scheduled: orderData.statusTimeline.scheduled?.toDate(),
          confirmed: orderData.statusTimeline.confirmed?.toDate(),
          outForPickup: orderData.statusTimeline.outForPickup?.toDate(),
          completed: orderData.statusTimeline.completed?.toDate(),
          paymentProcessed: orderData.statusTimeline.paymentProcessed?.toDate()
        }
      });
    });

    res.status(200).json({
      success: true,
      count: orders.length,
      orders
    });

  } catch (error) {
    console.error("Error fetching orders:", error);
    next(error);
  }
});

// Get orders with status filter
router.get("/query_orders", async (req, res, next) => {
  try {
    const { status } = req.query;
    const db = admin.firestore();
    let query = db.collection("orders");

    // Apply status filter if provided
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();

    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        pickupId: data.pickupId,
        status: data.status,
        createdAt: data.createdAt.toDate(),
        items: data.items.map(item => ({
          name: item.scrapType.name,
          quantity: item.quantity,
          price: item.quantity * item.scrapType.ratePerKg
        })),
        totalAmount: data.totalAmount
      };
    });

    res.status(200).json({
      success: true,
      count: orders.length,
      orders
    });

  } catch (error) {
    console.error("Error fetching orders:", error);
    next(error);
  }
});

// Get all the users orders
router.get("/users/:userId/orders", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required"
      });
    }

    const db = admin.firestore();
    let query = db.collection("orders").where('userId', '==', userId);

    // Add status filter if provided
    if (status) {
      const validStatuses = ['pending', 'approved', 'completed', 'cancelled'];
      // if (!validStatuses.includes(status)) {
      //   return res.status(400).json({
      //     success: false,
      //     error: "Invalid status value",
      //     validStatuses
      //   });
      // }
      query = query.where('status', '==', status);
    }
    const snapshot = await query.orderBy('createdAt', 'desc').get();
    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        orderId: doc.id,
        collectorId :  data.collectorId,
        pickupId: data.pickupId,
        status: data.status,
        createdAt: data.createdAt.toDate(),
        pickupDate: data.pickupDate?.toDate(),
        items: data.items,
        totalAmount: data.totalAmount,
        paymentStatus: data.paymentStatus,
        statusTimeline :  data.statusTimeline,
        pickupAddress : data.pickupAddress,
        pickupAddressPersonName : data.pickupAddressPersonName,
        pickupAddressType : data.pickupAddressType,
        collectorDetails : getCollectorDetails(data.collectorId)
      };
    });

    res.status(200).json({
      success: true,
      userId,
      count: orders.length,
      orders
    });

  } catch (error) {
    console.error(`Error fetching orders for user ${req.params.userId}:`, error);
    next(error);
  }
});

router.put("/update-address/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const { newAddress } = req.body;
  const db =  admin.firestore();
  if (!newAddress) {
    return res.status(400).json({ error: "New address is required" });
  }

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return res.status(404).json({ error: "Order not found" });
    }

    await orderRef.update({ pickupAddress: newAddress });

    return res.status(200).json({ message: "Address updated successfully" });
  } catch (err) {
    console.error("Error updating address:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post('/cancel', async (req, res) => {
  try {
    const { orderId, userId, reason } = req.body;
    const db = admin.firestore();

    // Validate input
    if (!orderId || !userId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderId, userId, or reason'
      });
    }

    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    // Check if order exists
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Verify user ownership
    if (orderDoc.data().userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: User does not own this order'
      });
    }

    // Check if already cancelled
    if (orderDoc.data().user_cancelled) {
      return res.status(400).json({
        success: false,
        error: 'Order is already cancelled'
      });
    }

    // Check order status
    const status = orderDoc.data().status;
    if (['Completed', 'Cancelled', 'Rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel order with status: ${status}`
      });
    }

    // Update order
    const updateData = {
      status: 'User Cancelled',
      user_cancelled: true,
      user_cancelled_date: admin.firestore.FieldValue.serverTimestamp(),
      user_cancelled_reason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await orderRef.update(updateData);

    // Move to rejected_orders collection (optional)
    await db.collection('cancelled_orders').doc(orderId).set({
      ...orderDoc.data(),
      ...updateData,
      originalCollection: 'orders'
    });

    return res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      orderId: orderId
    });

  } catch (error) {
    console.error('Error cancelling order:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});


router.get('/fetch_all_cat', async (req, res) => {
  try {
    const db = admin.firestore();
    const collectionRef = db.collection('scrap_categories');
    const snapshot = await collectionRef.get();
    const categories = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.status(200).json({ categories });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching categories', details: error.message });
  }
});

router.post('/add_scrap_cat', async (req, res) => {
  const { cat_name } = req.body;
  const db = admin.firestore();
  const collectionRef = db.collection('scrap_categories');
  if (!cat_name) {
    return res.status(400).json({ error: 'cat_name is required' });
  }

  try {
    const docRef = await collectionRef.add({ cat_name });
    res.status(201).json({ message: 'Category created', id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating category', details: error.message });
  }
});

router.put('/add_scrap_cat/:id', async (req, res) => {
  const { id } = req.params;
  const { cat_name } = req.body;
  const db = admin.firestore();
  const collectionRef = db.collection('scrap_categories');
  try {
    await collectionRef.doc(id).update({ cat_name });
    res.status(200).json({ message: 'Category updated' });
  } catch (error) {
    res.status(500).json({ error: 'Error updating category', details: error.message });
  }
});

router.delete('/del_scrap_cat/:id', async (req, res) => {
  const { id } = req.params;
  const db = admin.firestore();
  const collectionRef = db.collection('scrap_categories');
  try {
    await collectionRef.doc(id).delete();
    res.status(200).json({ message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting category', details: error.message });
  }
});

//for users
router.patch('/reschedulePickup', async (req, res) => {
  const { orderId, newPickupDate } = req.body;

  if (!orderId || !newPickupDate) {
    return res.status(400).json({ message: 'orderId and newPickupDate are required.' });
  }

  const db = admin.firestore();
  try {
    
    const orderRef = db.collection('orders').doc(orderId);

    // Update pickupDate (assumes you send newPickupDate as an ISO string)
    await orderRef.update({
      pickupDate: new Date(newPickupDate),
    });


    res.status(200).json({ message: 'Pickup date rescheduled successfully.' });
  } catch (err) {
    console.error('Error rescheduling pickup date:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/getCollectorDetails', async (req, res) => {
  const { collectorId } = req.query;

  if (!collectorId) {
    return res.status(400).json({ message: 'collectorId is required.' });
  }

  try {
    const db = admin.firestore();
    const collectorDoc = await db.collection('partners').doc(String(collectorId)).get();

    if (!collectorDoc.exists) {
      return res.status(404).json({ message: 'Collector not found.' });
    }

    const collectorData = collectorDoc.data();
    const result = {
      name: collectorData.fullName,
      phone: collectorData.phoneNumber,
      profileImage: collectorData.documents?.profilePhoto || null
    };

    res.status(200).json({ collectorDetails: result });
  } catch (error) {
    console.error('Error fetching collector details:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});



//for rescheduling the order-> User will reschedult the order whenever he wants 
router.patch('/reschedulePickup', async (req, res) => {
  const { orderId, newPickupDate } = req.body;

  if ( !orderId || !newPickupDate) {
    return res.status(400).json({ message: 'collectorId, orderId, and newPickupDate are required.' });
  }

  const db = admin.firestore();

  try {
    const partnersQuery = db.collection('partners_orders')
      // .where('collectorId', '==', String(collectorId))
      .where('orderId', '==', orderId);

    const partnersSnapshot = await partnersQuery.get();

    if (partnersSnapshot.empty) {
      return res.status(404).json({ message: 'No matching partner order found.' });
    }

    const partnerDocRef = partnersSnapshot.docs[0].ref;

    await partnerDocRef.update({
      'originalOrderData.pickupDate': new Date(newPickupDate),
    });

    const orderDocRef = db.collection('orders').doc(orderId);

    const orderDoc = await orderDocRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ message: 'Matching order not found in orders collection.' });
    }

    await orderDocRef.update({
      pickupDate: new Date(newPickupDate),
    });

    res.status(200).json({ message: 'Pickup date rescheduled successfully' });
  } catch (err) {
    console.error('Error rescheduling pickup:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;