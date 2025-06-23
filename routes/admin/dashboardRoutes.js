const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const admin = require('../../firebase1');
require('dotenv').config();
const JWT_SECRET = 'adminScrapToken'; 

const db = admin.firestore();
router.post('/adminLogin', async (req, res) => {
  const { myScrapName, myScrapPass } = req.body;

  if (!myScrapName || !myScrapPass) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  try {
    const snapshot = await db.collection('admin_me').get();
    let admin = null;

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.myScrapName === myScrapName && data.myScrapPass === myScrapPass) {
        admin = { id: doc.id, ...data };
      }
    });

    if (admin) {
      const token = jwt.sign(
        { id: admin.id, name: admin.myScrapName },
        JWT_SECRET,
        { expiresIn: '1d' }
      );

      return res.status(200).json({
        message: 'Login successful',
        token,
        admin: { id: admin.id, name: admin.myScrapName }
      });
    } else {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    if (snapshot.empty) {
      return res.status(404).json({ message: 'No users found' });
    }
    
    const users = [];
    snapshot.forEach(doc => {
      users.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.get("/scrap_analytics", async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    
    // Get all scrap types first to map IDs to names
    const scrapTypesSnapshot = await db.collection('scrap_types').get();
    const scrapTypes = {};
    scrapTypesSnapshot.forEach(doc => {
      scrapTypes[doc.data().id] = doc.data();
    });

    // Get all orders for the current year
    const ordersSnapshot = await db.collection('orders')
      .where('createdAt', '>=', new Date(`${currentYear}-01-01`))
      .get();
    

    
    // Initialize monthly data structure
    const monthlyData = {};
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    months.forEach(month => {
      monthlyData[month] = {};
      // Initialize each scrap type for the month
      Object.keys(scrapTypes).forEach(scrapId => {
        monthlyData[month][scrapTypes[scrapId].name] = {
          quantity: 0,
          totalValue: 0
        };
      });
    });

    // Process each order
    ordersSnapshot.forEach(orderDoc => {
      const order = orderDoc.data();
      if (!order.createdAt || !order.items) return;

      const orderDate = order.createdAt.toDate();
      const monthName = months[orderDate.getMonth()];
      console.log("month name  " + monthName);

      order.items.forEach(item => {
        if (!item.scrapType || !item.scrapType.id || !item.quantity) return;
        
        const scrapTypeId = item.scrapType.id;
        console.log(scrapTypeId);
        const scrapType = scrapTypes[scrapTypeId];
        if (!scrapType){
          console.log("dont wanna go ahead");
          return;
        } 

        console.log("There you are go"  + item.quantity);

        const quantity = Number(item.quantity) || 0;
        const rate = Number(scrapType.ratePerKg) || 0;
        const value = quantity * rate;


        monthlyData[monthName][scrapType.name].quantity += quantity;
        monthlyData[monthName][scrapType.name].totalValue += value;
        
        console.log("this one is the monthly data"  +  monthlyData[monthName][scrapType.name].quantity);
      });
    
        });

    res.status(200).json({
      success: true,
      data: monthlyData,
      year: currentYear
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch scrap analytics",
      message: e.message
    });
  }
});


router.get("/scrap_analytics_range", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // Validate date inputs
    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: "Missing fromDate or toDate parameters"
      });
    }

    // Convert to Date objects
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD"
      });
    }

    const scrapTypesSnapshot = await db.collection('scrap_types').get();
    const scrapTypes = {};
    scrapTypesSnapshot.forEach(doc => {
      const data = doc.data();
      scrapTypes[data.id] = data;
    });


    // CReated at (to fnd all the between the given date span)
    const ordersSnapshot = await db.collection('orders')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .get();

    const totals = {};
    Object.keys(scrapTypes).forEach(scrapId => {
      totals[scrapTypes[scrapId].name] = {
        quantity: 0,
        totalValue: 0
      };
    });

    ordersSnapshot.forEach(orderDoc => {
      const order = orderDoc.data();
      if (!order.items) return;

      order.items.forEach(item => {
        if (!item.scrapType?.id || !item.quantity) return;
        
        const scrapType = scrapTypes[item.scrapType.id];
        if (!scrapType) return;

        const quantity = Number(item.quantity) || 0;
        const rate = Number(scrapType.ratePerKg) || 0;
        const value = quantity * rate;

        totals[scrapType.name].quantity += quantity;
        totals[scrapType.name].totalValue += value;
      });
    });

    // reduce krenge to get all the totals
    const grandTotals = {
      totalQuantity: Object.values(totals).reduce((sum, item) => sum + item.quantity, 0),
      totalValue: Object.values(totals).reduce((sum, item) => sum + item.totalValue, 0)
    };


    res.status(200).json({
      success: true,
      data: {
        scrapTypeTotals: totals,
        grandTotals,
        dateRange: {
          from: fromDate,
          to: toDate
        }
      }
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch scrap totals",
      message: e.message
    });
  }
});

router.get("/all_users_scrap_analytics", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // Validate inputs
    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: "Missing fromDate or toDate parameters"
      });
    }

    // Convert to Date objects
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD"
      });
    }

    // Get all scrap types
    const scrapTypesSnapshot = await db.collection('scrap_types').get();
    const scrapTypes = {};
    scrapTypesSnapshot.forEach(doc => {
      const data = doc.data();
      scrapTypes[data.id] = data;
    });

    // Get all orders within date range
    const ordersSnapshot = await db.collection('orders')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .get();

    // Initialize data structures
    const userAnalytics = {}; // Key: userId, Value: user data
    const scrapTypeTotals = {}; // Overall scrap type totals
    const allOrderDetails = []; // All order details

    // Initialize scrap type totals
    Object.keys(scrapTypes).forEach(scrapId => {
      scrapTypeTotals[scrapTypes[scrapId].name] = {
        quantity: 0,
        totalValue: 0
      };
    });

    // Process each order
    ordersSnapshot.forEach(orderDoc => {
      const order = orderDoc.data();
      if (!order.items || !order.userId) return;

      const userId = order.userId;
      
      // Initialize user entry if not exists
      if (!userAnalytics[userId]) {
        userAnalytics[userId] = {
          userInfo: { userId },
          scrapTypes: {},
          totalQuantity: 0,
          totalValue: 0,
          orderCount: 0
        };
        
        // Initialize scrap types for this user
        Object.keys(scrapTypes).forEach(scrapId => {
          userAnalytics[userId].scrapTypes[scrapTypes[scrapId].name] = {
            quantity: 0,
            totalValue: 0
          };
        });
      }

      // Store order details
      const orderInfo = {
        orderId: orderDoc.id,
        userId,
        pickupId: order.pickupId || '',
        totalAmount: order.totalAmount || 0,
        date: order.createdAt?.toDate()?.toISOString(),
        status: order.status || 'unknown'
      };
      allOrderDetails.push(orderInfo);
      userAnalytics[userId].orderCount++;

      // Process each item in order
      order.items.forEach(item => {
        if (!item.scrapType?.id || !item.quantity) return;
        
        const scrapType = scrapTypes[item.scrapType.id];
        if (!scrapType) return;

        const quantity = Number(item.quantity) || 0;
        const rate = Number(scrapType.ratePerKg) || 0;
        const value = quantity * rate;

        // Update user-specific totals
        userAnalytics[userId].scrapTypes[scrapType.name].quantity += quantity;
        userAnalytics[userId].scrapTypes[scrapType.name].totalValue += value;
        userAnalytics[userId].totalQuantity += quantity;
        userAnalytics[userId].totalValue += value;

        // Update overall scrap type totals
        scrapTypeTotals[scrapType.name].quantity += quantity;
        scrapTypeTotals[scrapType.name].totalValue += value;
      });
    });

    // Convert userAnalytics object to array
    const usersData = Object.values(userAnalytics);

    // Get additional user info from users collection
    const usersSnapshot = await db.collection('users')
      .where('email', 'in', Object.keys(userAnalytics))
      .get();

    usersSnapshot.forEach(userDoc => {
      const userData = userDoc.data();
      if (userAnalytics[userData.email]) {
        userAnalytics[userData.email].userInfo = {
          userId: userData.email,
          name: userData.name || 'Unknown',
          phone: userData.phone || '',
          totalScrapped: userData.totalScrapped || 0
        };
      }
    });

    // Calculate grand totals
    const grandTotals = {
      totalQuantity: Object.values(scrapTypeTotals).reduce((sum, item) => sum + item.quantity, 0),
      totalValue: Object.values(scrapTypeTotals).reduce((sum, item) => sum + item.totalValue, 0),
      totalUsers: usersData.length,
      totalOrders: allOrderDetails.length
    };

    res.status(200).json({
      success: true,
      data: {
        scrapTypeTotals,
        usersData,
        grandTotals,
        orderDetails: allOrderDetails,
        dateRange: {
          from: fromDate,
          to: toDate
        }
      }
    });

  } catch (e) {
    console.error("Error in all_users_scrap_analytics:", e);
    res.status(500).json({
      success: false,
      error: "Failed to fetch all users scrap analytics",
      message: e.message
    });
  }
});

router.get("/user_scrap_totals", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: "Missing fromDate or toDate parameters"
      });
    }

    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD"
      });
    }

    const ordersSnapshot = await db.collection('orders')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .get();

    const userTotals = {};

    ordersSnapshot.forEach(orderDoc => {
      const order = orderDoc.data();
      if (!order.items || !order.userId) return;

      const userId = order.userId;
      
      if (!userTotals[userId]) {
        userTotals[userId] = {
          totalQuantity: 0,
          totalValue: 0,
          orderCount: 0
        };
      }

      userTotals[userId].orderCount++;

      order.items.forEach(item => {
        if (!item.quantity) return;

        const quantity = Number(item.quantity) || 0;
        const rate = item.scrapType?.ratePerKg ? Number(item.scrapType.ratePerKg) : 0;
        const value = quantity * rate;

        userTotals[userId].totalQuantity += quantity;
        userTotals[userId].totalValue += value;
      });
    });

    const userIds = Object.keys(userTotals);
    if (userIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          users: [],
          grandTotals: {
            totalQuantity: 0,
            totalValue: 0,
            totalUsers: 0,
            totalOrders: 0
          },
          dateRange: {
            from: fromDate,
            to: toDate
          }
        }
      });
    }


    const usersSnapshot = await db.collection('users')
      .where('email', 'in', userIds)
      .get();

    const usersData = [];
    usersSnapshot.forEach(userDoc => {
      const userData = userDoc.data();
      const totals = userTotals[userData.email] || {};
      
      usersData.push({
        userId: userData.email,
        name: userData.name || 'Unknown',
        phone: userData.phone || '',
        totalQuantity: totals.totalQuantity || 0,
        totalValue: totals.totalValue || 0,
        orderCount: totals.orderCount || 0
      });
    });

  
    const grandTotals = {
      totalQuantity: usersData.reduce((sum, user) => sum + user.totalQuantity, 0),
      totalValue: usersData.reduce((sum, user) => sum + user.totalValue, 0),
      totalUsers: usersData.length,
      totalOrders: usersData.reduce((sum, user) => sum + user.orderCount, 0)
    };

    res.status(200).json({
      success: true,
      data: {
        users: usersData,
        grandTotals,
        dateRange: {
          from: fromDate,
          to: toDate
        }
      }
    });

  } catch (e) {
    console.error("Error in user_scrap_totals:", e);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user scrap totals",
      message: e.message
    });
  }
});

router.get('/dashCounts', async (req, res) => {
  try {
    const db = admin.firestore();
    const collections = [
      'zones',
      'orders',
      'partners',
      'scrap_types',
      'users',
      'blogs',
      'buyers',
      'bulkEnquiries',
      'buyerEnquiry',
      'campaignEnquiry'
    ];

    const counts = {};
    for (const collection of collections) {
      try {
        const snapshot = await db.collection(collection).get();
        counts[collection] = snapshot.size;
      } catch (error) {
        console.error(`Error counting ${collection}:`, error);
        counts[collection] = null;
      }
    }

    res.json({
      success: true,
      counts,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

  } catch (error) {
    console.error('Error getting collection counts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get collection counts'
    });
  }
});

const storesRef = db.collection('stores');

// ADD STORE
router.post('/store/add', async (req, res) => {
  try {
    const { store_name, store_address, latitude, longitude } = req.body;

    const geoPoint = new admin.firestore.GeoPoint(latitude, longitude);

    const newDoc = storesRef.doc();
    await newDoc.set({
      store_name,
      store_address,
      location: geoPoint,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    res.json({ success: true, id: newDoc.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// EDIT STORE
router.put('/store/edit/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { store_name, store_address, latitude, longitude } = req.body;

    const geoPoint = new admin.firestore.GeoPoint(latitude, longitude);

    await storesRef.doc(id).update({
      store_name,
      store_address,
      location: geoPoint,
      updatedAt: new Date()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE STORE
router.delete('/store/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await storesRef.doc(id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TOGGLE ACTIVE/INACTIVE
router.patch('/store/toggle/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const storeDoc = await storesRef.doc(id).get();
    if (!storeDoc.exists) return res.status(404).json({ error: 'Store not found' });

    const currentStatus = storeDoc.data().isActive;
    await storesRef.doc(id).update({
      isActive: !currentStatus,
      updatedAt: new Date()
    });

    res.json({ success: true, isActive: !currentStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;