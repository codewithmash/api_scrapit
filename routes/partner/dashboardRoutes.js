const admin = require("../../firebase1");
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const db =  admin.firestore();
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Format phone number
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;

    // Send OTP via Firebase
    const verificationId = await admin.auth().PhoneAuthProvider.verifyPhoneNumber(
      formattedPhone,
      new admin.auth.RecaptchaVerifier('recaptcha-container', {
        size: 'invisible',
        callback: () => {} // Required but unused
      })
    );

    // Store verification ID in session
    req.session.verificationId = verificationId;
    req.session.otpPhoneNumber = formattedPhone;

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      verificationId,
      userExists: false
    });
    
  } catch (error) {
    console.error('Error sending OTP:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'auth/too-many-requests') {
      return res.status(429).json({ 
        error: 'Too many attempts',
        details: 'Please try again later'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to send OTP',
      details: error.message,
      code: error.code 
    });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required' });
    }
    
    // Format phone number
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;

    const auth = admin.auth();
    const verificationId = req.session.verificationId; // From send-otp
    
    const credential = await auth.PhoneAuthProvider.credential(verificationId, otp);
    const userCredential = await auth.signInWithCredential(credential);
    const authToken = await userCredential.user.getIdToken();

    const partnerDoc = await db.collection('partners').doc(formattedPhone).get();

    if (!partnerDoc.exists) {
      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully',
        userExists: false,
        phoneNumber: formattedPhone,
        authToken
      });
    }

    const partnerData = partnerDoc.data();

    const response = {
      success: true,
      userExists: true,
      phoneNumber: formattedPhone,
      authToken,
      approvalStatus: partnerData.status || 'unknown',
      fullName: partnerData.fullName,
      email: partnerData.email
    };

    switch (partnerData.status) {
      case 'approved':
        response.message = 'Your account is approved and active';
        response.userDetails = {
          ...partnerData,
          documents: partnerData.documents || null
        };
        break;

      case 'pending':
        response.message = 'Your application is under review';
        response.details = 'Please wait for admin approval';
        if (partnerData.submittedAt) {
          response.pendingSince = partnerData.submittedAt.toDate().toISOString();
        }
        break;

      case 'rejected':
        response.message = 'Your application was rejected';
        response.details = partnerData.rejectionReason || 'No reason provided';
        if (partnerData.rejectedAt) {
          response.rejectedOn = partnerData.rejectedAt.toDate().toISOString();
        }
        if (partnerData.rejectedBy) {
          response.rejectedBy = partnerData.rejectedBy;
        }
        break;

      default:
        response.message = 'Your application status is unknown';
        response.details = 'Please contact support';
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('OTP verification error:', error);
    
    if (error.code === 'auth/invalid-verification-code') {
      return res.status(400).json({ 
        error: 'Invalid OTP code',
        details: 'The provided OTP is incorrect or expired' 
      });
    }
    
    res.status(400).json({ 
      error: 'OTP verification failed',
      details: error.message,
      code: error.code 
    });
  }
});

const uploadFields = [
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'drivingLicense', maxCount: 1 },
  { name: 'vehicleRC', maxCount: 1 }
];

router.post('/signup', upload.fields(uploadFields), async (req, res) => {
  try {
    const { 
      phoneNumber, 
      fullName, 
      email,
      vehicleType,
      address,
      bankDetails,
    } = req.body;

    // Basic validation
    if (!phoneNumber || !fullName) {
      return res.status(400).json({ error: 'Phone number and full name are required' });
    }

    const partnerRef = db.collection('partners').doc(phoneNumber);
    const partnerDoc = await partnerRef.get();
    
    if (partnerDoc.exists) {
      return res.status(400).json({ error: 'Partner already registered' });
    }

    const documents = {};
    for (const [fieldName, fileArray] of Object.entries(req.files)) {
      const file = fileArray[0];
      const fileName = `partners/${phoneNumber}/${fieldName}_${Date.now()}`;
      const fileUpload = bucket.file(fileName);

      await fileUpload.save(file.buffer, {
        metadata: { contentType: file.mimetype }
      });

      const [url] = await fileUpload.getSignedUrl({
        action: 'read',
        expires: '03-09-2491' 
      });

      documents[fieldName] = url;
    }

    const partnerData = {
      phoneNumber,
      fullName,
      email: email || null,
      vehicleType: vehicleType || 'Not specified',
      address: address || null,
      bankDetails: bankDetails ? JSON.parse(bankDetails) : null,
      documents,
      status: 'pending', 
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedOrder : 0,
      pendingOrder : 0,
    };
    await partnerRef.set(partnerData);
    try {
      await admin.auth().createUser({
        uid: phoneNumber,
        phoneNumber,
        email: email || undefined,
        displayName: fullName,
        disabled: true 
      });
    } catch (authError) {
      console.warn('Auth account creation failed:', authError);
    }

    res.status(201).json({
      success: true,
      message: 'Registration submitted for admin approval',
      partnerId: phoneNumber
    });

  } catch (error) {
    console.error('Partner signup error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

const updateFields = [
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'drivingLicense', maxCount: 1 },
  { name: 'vehicleRC', maxCount: 1 }
];

router.post('/update-partner/:partnerId', upload.fields(updateFields), async (req, res) => {
  try {
    const { partnerId } = req.params;
    const {
      fullName,
      email,
      vehicleType,
      address,
      bankDetails,
      status 
    } = req.body;

    
    if (!partnerId) {
      return res.status(400).json({ 
        success: false,
        error: 'Phone number is required' 
      });
    }

    const partnerRef = db.collection('partners').doc(partnerId);
    const partnerDoc = await partnerRef.get();
    
    if (!partnerDoc.exists) {
      return res.status(404).json({ 
        success: false,
        error: 'Partner not found' 
      });
    }

    const currentData = partnerDoc.data();
    const documents = { ...currentData.documents };

    // Handle file uploads if any
    if (req.files) {
      for (const [fieldName, fileArray] of Object.entries(req.files)) {
        const file = fileArray[0];
        const fileName = `partners/${partnerId}/${fieldName}_${Date.now()}`;
        const fileUpload = bucket.file(fileName);

        // Delete old file if exists
        if (documents[fieldName]) {
          try {
            const oldFileName = documents[fieldName].split('/').pop();
            await bucket.file(`partners/${partnerId}/${oldFileName}`).delete();
          } catch (deleteError) {
            console.warn(`Could not delete old ${fieldName}:`, deleteError);
          }
        }

        // Upload new file
        await fileUpload.save(file.buffer, {
          metadata: { contentType: file.mimetype }
        });

        const [url] = await fileUpload.getSignedUrl({
          action: 'read',
          expires: '03-09-2491'
        });

        documents[fieldName] = url;
      }
    }

    // Prepare update data
    const updateData = {
      ...(fullName && { fullName }),
      ...(email && { email }),
      ...(vehicleType && { vehicleType }),
      ...(address && { address }),
      ...(bankDetails && { bankDetails: JSON.parse(bankDetails) }),
      documents,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Only update status if provided (admin privilege)
      ...(status && ['pending', 'approved', 'rejected', 'suspended'].includes(status) && { status })
    };

    // Update Firestore
    await partnerRef.update(updateData);

    // Update Auth if email/name changed
    if (email || fullName) {
      try {
        await admin.auth().updateUser(partnerId, {
          ...(email && { email }),
          ...(fullName && { displayName: fullName })
        });
      } catch (authError) {
        console.warn('Auth update failed:', authError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Partner updated successfully',
      partnerId: partnerId,
      updatedFields: Object.keys(updateData)
    });

  } catch (error) {
    console.error('Partner update error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Update failed', 
      details: error.message 
    });
  }
});

router.post('/approve-partner', async (req, res) => {
  try {
    const { adminId, partnerPhone, action, rejectionReason } = req.body;

    const isAdmin = await verifyAdmin(adminId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const partnerRef = db.collection('partners').doc(partnerPhone);
    const partnerDoc = await partnerRef.get();

    if (!partnerDoc.exists) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    if (action === 'approve') {
      await partnerRef.update({
        status: 'approved',
        approvedBy: adminId,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      try {
        await admin.auth().updateUser(partnerPhone, { disabled: false });
      } catch (authError) {
        console.warn('Auth account enable failed:', authError);
      }

      return res.json({ success: true, message: 'Partner approved successfully' });

    } else if (action === 'reject') {
      // Update partner status
      await partnerRef.update({
        status: 'rejected',
        rejectedBy: adminId,
        rejectionReason: rejectionReason || 'Not specified',
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    
      return res.json({ success: true, message: 'Partner rejected' });

    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Admin approval error:', error);
    res.status(500).json({ error: 'Approval process failed', details: error.message });
  }
});

router.delete('/delete-partner/:partnerId', async (req, res) => {
  try {
    const {partnerId} = req.params;

    console.log("A");
    if (!partnerId) {
      return res.status(400).json({
        success: false,
        error: 'Partner ID is required'
      });
    }

    console.log("B");
    const partnerRef = db.collection('partners').doc(partnerId);
    const partnerDoc = await partnerRef.get();

    if (!partnerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Partner not found'
      });
    }
    
    console.log("c");
    const [files] = await bucket.getFiles({ prefix: `partners/${partnerId}/` });
    for (const file of files) {
      try {
        await file.delete();
      } catch (fileError) {
        console.warn(`Failed to delete file ${file.name}:`, fileError);
      }
    }

    await partnerRef.delete();

    try {
      await admin.auth().deleteUser(partnerId);
    } catch (authError) {
      console.warn(`Could not delete auth user (${partnerId}):`, authError.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Partner and associated data deleted successfully',
      partnerId: partnerId
    });

  } catch (error) {
    console.error('Delete partner error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete partner',
      details: error.message
    });
  }
});

router.get('/partners', async (req, res) => {
  try {
    const snapshot = await db.collection('partners').get();
    
    const partners = [];
    snapshot.forEach(doc => {
      partners.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json({
      success: true,
      total: partners.length,
      partners
    });
  } catch (error) {
    console.error('Error fetching partners:', error);
    res.status(500).json({ error: 'Failed to fetch partners', details: error.message });
  }


});

router.get('/count/:collectorId', async (req, res) => {
  try {
    const { collectorId } = req.params;
    const db = admin.firestore();
    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const endOfToday = new Date(now.setHours(23, 59, 59, 999));

    const todaySnapshot = await db.collection('partners_orders')
      .where('collectorId', '==', collectorId)
      .where('originalOrderData.pickupDate', '>=', startOfToday)
      .where('originalOrderData.pickupDate', '<=', endOfToday)
      .count()
      .get();

    // Count upcoming pickups (after today)
    const upcomingSnapshot = await db.collection('partners_orders')
      .where('collectorId', '==', collectorId)
      .where('originalOrderData.pickupDate', '>', endOfToday)
      .where('status', '==', 'scheduled')
      .count()
      .get();

    res.status(200).json({
      success: true,
      collectorId,
      data: {
        todayPickupsCount: todaySnapshot.data().count,
        upcomingPickupsCount: upcomingSnapshot.data().count
      }
    });

  } catch (error) {
    console.error('Error counting orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to count orders',
      details: error.message
    });
  }
});

router.get('/today/:collectorId', async (req, res) => {
  try {
    const { collectorId } = req.params;
    const db = admin.firestore();
    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const endOfToday = new Date(now.setHours(23, 59, 59, 999));

    const snapshot = await db.collection('partners_orders')
      .where('collectorId', '==', collectorId)
      .where('originalOrderData.pickupDate', '>=', startOfToday)
      .where('originalOrderData.pickupDate', '<=', endOfToday)
      .orderBy('originalOrderData.pickupDate')
      .get();

    const pickups = [];
    snapshot.forEach(doc => {
      const order = doc.data();
      pickups.push({
        id: doc.id,
        orderId: order.orderId,
        pickupId: order.originalOrderData?.pickupId || '',
        pickupAddress: order.originalOrderData?.pickupAddress || '',
        pickupDate: order.originalOrderData?.pickupDate?.toDate()?.toISOString(),
        preparationInstructions: order.originalOrderData?.preparationInstructions || '',
        items: order.originalOrderData?.items || [],
        status: order.status
      });
    });

    res.status(200).json({
      success: true,
      collectorId,
      data: pickups,
      count: pickups.length
    });

  } catch (error) {
    console.error('Error fetching today\'s pickups:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch today\'s pickups',
      details: error.message
    });
  }
});

router.get('/orders', async (req, res) => {
    try {
        const db = admin.firestore();
        let ordersRef = db.collection('partners_orders');
        
        // Add status filter if provided
        if (req.query.status) {
            ordersRef = ordersRef.where('status', '==', req.query.status);
        }
        
        const snapshot = await ordersRef.get();
        
        if (snapshot.empty) {
            return res.status(404).json({ 
                message: req.query.status 
                    ? `No orders found with status '${req.query.status}'`
                    : 'No orders found'
            });
        }
        
        const orders = [];
        snapshot.forEach(doc => {
            orders.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        res.json(orders);
    } catch (error) {
        console.error('Error fetching partners orders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function verifyAdmin(adminId) {
  const adminDoc = await db.collection('admin_me').doc(adminId).get();
  return adminDoc.exists;
}

router.put('/:id', async (req, res) => {
  try {
    const partnerId = req.params.id;
    const {
      fullName,
      phoneNumber,
      address,
      vehicleType,
      status,
      email
    } = req.body;

    if (!partnerId) {
      return res.status(400).json({ error: 'Partner ID is required' });
    }

    const partnerRef = db.collection('partners').doc(partnerId);
    const doc = await partnerRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    const updateData = {
      updateAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (fullName) updateData.fullName = fullName;

    if (phoneNumber) {
      if (!/^\+?\d{10,15}$/.test(phoneNumber)) {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }
      updateData.phoneNumber = phoneNumber;
    }

    if (address) updateData.address = address;
    if (vehicleType) updateData.vehicleType = vehicleType;

    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      updateData.email = email;
    }

    if (status) {
      updateData.status = status;
      if (status === 'approved') {
        updateData.approveAt = admin.firestore.FieldValue.serverTimestamp();
        updateData.approveBy = req.user?.email || 'system';
      }
    }

    await partnerRef.update(updateData);

    const updatedDoc = await partnerRef.get();

    return res.status(200).json({
      success: true,
      message: 'Partner updated successfully',
      partner: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });

  } catch (error) {
    console.error('Error updating partner:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update partner',
      details: error.message
    });
  }
});

router.put('/:id/bank-details', async (req, res) => {
  try {
    const partnerId = req.params.id;
    const { bankDetails } = req.body;

    if (!partnerId) {
      return res.status(400).json({ error: 'Partner ID is required' });
    }

    if (!bankDetails || typeof bankDetails !== 'object') {
      return res.status(400).json({ error: 'bankDetails must be a valid object' });
    }

    const requiredBankFields = [
      'accountHolderName',
      'accountNumber',
      'bankName',
      'ifscCode'
    ];

    for (const field of requiredBankFields) {
      if (!bankDetails[field]) {
        return res.status(400).json({
          error: `bankDetails.${field} is required`
        });
      }
    }

    if (!/^\d{9,18}$/.test(bankDetails.accountNumber)) {
      return res.status(400).json({
        error: 'Account number must be 9-18 digits'
      });
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankDetails.ifscCode)) {
      return res.status(400).json({
        error: 'Invalid IFSC code format'
      });
    }

    const partnerRef = db.collection('partners').doc(partnerId);
    const doc = await partnerRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    await partnerRef.update({
      bankDetails: bankDetails,
      updateAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedDoc = await partnerRef.get();

    return res.status(200).json({
      success: true,
      message: 'Bank details updated successfully',
      partner: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });

  } catch (error) {
    console.error('Error updating bank details:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update bank details',
      details: error.message
    });
  }
});


router.get('/Porders', async (req, res) => {
  const { collectorId } = req.query;

  try {
    let query = db.collection('partners_orders');

    if (collectorId === 'null') {
      query = query.where('collectorId', '==', null);
    } else if (collectorId) {
      query = query.where('collectorId', '==', String(collectorId));
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      return res.status(404).json({ message: 'No orders found' });
    }

    const orders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


//for rescheduling the order
router.patch('/reschedulePartnerPickup', async (req, res) => {
  const { collectorId, orderId, newPickupDate } = req.body;

  if (!collectorId || !orderId || !newPickupDate) {
    return res.status(400).json({ message: 'collectorId, orderId, and newPickupDate are required.' });
  }

  const db = admin.firestore();

  try {
    const partnersQuery = db.collection('partners_orders')
      .where('collectorId', '==', String(collectorId))
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



// For updating order status

// Route to update partner order status
router.patch('/updatePartnerOrderStatus', upload.array('photos'), async (req, res) => {
  const {
    collectorId,
    orderId,
    newStatus,
    weight,
    additionalInfo
  } = req.body;

  if (!collectorId || !orderId || !newStatus) {
    return res.status(400).json({ message: 'collectorId, orderId, and newStatus are required.' });
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  let uploadedPhotoUrls = [];

  try {
    if (newStatus === 'completed') {
      if (!weight || !additionalInfo || !req.files || req.files.length === 0) {
        return res.status(400).json({
          message: 'To mark as completed, weight, photos, and additionalInfo are required.'
        });
      }
      for (const file of req.files) {
        const fileName = `partner_photos/${Date.now()}_${file.originalname}`;
        const fileRef = bucket.file(fileName);
        const stream = fileRef.createWriteStream({
          metadata: {
            contentType: file.mimetype,
          },
        });

        await new Promise((resolve, reject) => {
          stream.on('error', reject);
          stream.on('finish', async () => {
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
            uploadedPhotoUrls.push(publicUrl);
            resolve();
          });
          stream.end(file.buffer);
        });
      }
    }

    const updateData = {
      status: newStatus,
      updatedAt: new Date(),
      [`statusTimeline.${newStatus}`]: new Date(),
    };

    if (newStatus === 'completed') {
      updateData.weight = weight;
      updateData.photos = uploadedPhotoUrls;
      updateData.additionalInfo = additionalInfo;
    }

    // Update partners_orders
    const partnersQuery = db.collection('partners_orders')
      .where('collectorId', '==', String(collectorId))
      .where('orderId', '==', orderId);

    const partnersSnapshot = await partnersQuery.get();

    if (partnersSnapshot.empty) {
      return res.status(404).json({ message: 'No matching partner order found.' });
    }

    const partnerDocRef = partnersSnapshot.docs[0].ref;
    await partnerDocRef.update(updateData);

    const orderDocRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderDocRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ message: 'Matching order not found in orders collection.' });
    }

    await orderDocRef.update(updateData);

    res.status(200).json({
      message: 'Order status updated successfully in both collections.',
      uploadedPhotos: uploadedPhotoUrls,
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});


router.get('/getCompletedPickups', async (req, res) => {
  const { collectorId } = req.query;
  const db = admin.firestore();

  try {
    let query = db.collection('partners_orders')
      .where('status', '==', 'completed');

    if (collectorId !== 'null') {
      query = query.where('collectorId', '==', String(collectorId));
    }

    const snapshot = await query.orderBy('updatedAt', 'desc').get();

    if (snapshot.empty) {
      return res.status(404).json({ message: 'No completed pickups found.' });
    }

    const completedOrders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({
      message: 'Completed pickups fetched successfully.',
      data: completedOrders
    });
  } catch (error) {
    console.error('Error fetching completed pickups:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});



router.post('/submitRating', async (req, res) => {
  const { collectorId, orderId, rating, review } = req.body;

  if (!collectorId || !orderId || !rating || !review) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await db.collection('partners_rating').add({
      collectorId,
      orderId,
      rating,
      review
    });
    return res.status(200).json({ success: true, message: 'Rating submitted' });
  } catch (err) {
    return res.status(500).json({ error: 'Error adding rating', details: err.message });
  }
});

router.get('/getRating', async (req, res) => {
  const collectorId = req.query.collectorId;

  if (!collectorId) {
    return res.status(400).json({ error: 'Missing collectorId in query' });
  }
const  db = admin.firestore();
  try {
    const snapshot = await db.collection('partners_rating')
                             .where('collectorId', '==', collectorId)
                             .get();

    if (snapshot.empty) {
      return res.status(200).json({ averageRating: 0, ratings: [] });
    }

    let total = 0;
    let count = 0;
    const ratings = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      total += data.rating;
      count++;
      ratings.push(data);
    });

    const average = parseFloat((total / count).toFixed(2));
    return res.status(200).json({ averageRating: average, ratings });
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching ratings', details: err.message });
  }
});



module.exports = router;