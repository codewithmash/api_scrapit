const express = require("express");
const router = express.Router();
const admin = require("../firebase1");
const nodemailer = require("nodemailer");
const bcrypt = require('bcrypt'); 
const saltRounds = 10;
// const { OAuth2Client } = require("google-auth-library");
// const client = new OAuth2Client("729103709945-mnsfpogikq7o3q6luq6oj8619m2icrba.apps.googleusercontent.com");
const multer = require("multer");



const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "codewithmash@gmail.com",
    pass: "zkxmcecbabhfummq", // Use app password
  },
});

router.post("/sign_up_mail_phone", async (req, res) => {
  console.log("Now the user is signing up");

  try {
    const {
      name,
      email,
      phone,
      referral_code,
      is_mail_user,
      is_verified,
      fcm
    } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ error: "Email or phone required" });
    }

    const db = admin.firestore();
    const userId = is_mail_user ? email : phone;

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Save user details in "users" collection
    await userRef.set(
      {
        name,
        email,
        phone,
        referral_code,
        is_mail_user,
        is_verified,
        wallet_amount: 0,
        orders: [],
        savedAdress: [],
        totalScrapped: 0,
        fcm,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.status(200).json({ message: "User Signed Up Successfully" });

  } catch (e) {
    console.error("Error in sign up:", e);
    res.status(500).json({ error: "Internal Server Error Occurred" });
  }
});

router.post("/send_otp",async (req, res) => {

    const {email, name} = req.body;
    console.log("sending an otp");
    // Email flow - generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
  try{
    const db = admin.firestore();
    // Save OTP to Firestore
    await db.collection('emailOtps').doc(email).set({
      otp,
      expiresAt,
    });
    
    // Send email
    const mailOptions = {
      from: 'Scrap It Scrapit@gmail.com',
      to: email,
      subject: 'ScrapIt OTP Authentication',
      text: `Hello ${name || ''},\n\nYour OTP is ${otp}. It is valid for 5 minutes.\n\nThanks,\nScrap It Team`,
    };

    console.log("Sending main means Sent otp");
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'OTP sent to email' });
  }
  catch(e){
    console.log("getting error");
    console.log(e);
    res.status(500).json({error: "Internal Server Error Occure"})
  }
} 
);



router.post('/setDoor', async (req, res) => {
  const { email, phoneNumber, password } = req.body;

  if ((!email && !phoneNumber) || !password) {
    return res.status(400).json({ error: 'Email or phoneNumber and password are required' });
  }

  const identifier = email || phoneNumber;

  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(identifier);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log("The user does not exist");
      return res.status(400).json({ error: 'User not found' });
    }

    // Hash password for Firestore
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    await userRef.update({ password: hashedPassword });
    console.log('Password updated in Firestore');

    let userRecord;
    try {
      // Fetch user by email or phoneNumber
      userRecord = email
        ? await admin.auth().getUserByEmail(email)
        : await admin.auth().getUserByPhoneNumber(phoneNumber);

      console.log('User exists in Firebase Auth:', userRecord.uid);

      // Update password in Firebase Auth
      await admin.auth().updateUser(userRecord.uid, { password: password });
      console.log('Password updated in Firebase Auth');

    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({
          email: email || undefined,
          phoneNumber: phoneNumber || undefined,
          emailVerified: !!email,
          password: password,
          displayName: "ScrapUser",
          disabled: false,
        });
        console.log('Successfully created new Firebase Auth user:', userRecord.uid);
      } else {
        throw error;
      }
    }

    return res.status(200).json({ message: 'Password set successfully in Firestore and Firebase Auth' });

  } catch (error) {
    console.error('Error in /setDoor:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify_email_otp', async (req, res) => {
  console.log("Now verifying the otp");
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const db = admin.firestore();
    const otpDocRef = db.collection('emailOtps').doc(email);
    const otpDoc = await otpDocRef.get();

    if (!otpDoc.exists) {
      return res.status(400).json({ error: 'No OTP found for this email' });
    }

    const data = otpDoc.data();

    // Check if expired
    if (Date.now() > data.expiresAt) {
      console.log(" the otp has been expired");
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Check OTP match
    if (data.otp !== otp) {
      console.log(" the otp is invalid not matching");
      return res.status(400).json({ error: 'Invalid OTP' });
    }
    
    // OTP is valid - delete the OTP document
    await otpDocRef.delete();
    return res.status(200).json({ 
      message: 'OTP verified successfully',
      canResetPassword: true
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post("/loginEmail", async (req, res) => {
  console.log("Attempting login...");

  try {
    const { email, password } = req.body;
    console.log(" this is my password ");
    console.log(password);
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = admin.firestore();
    const currentUserRef = db.collection('users').doc(email);
    const currentUserDoc = await currentUserRef.get();

    if (!currentUserDoc.exists) {
      console.log("User does not exist");
      return res.status(400).json({ error: 'User not found' });
    }

    const userData = currentUserDoc.data();

    // Check if password field exists
    if (!userData.password) {
      return res.status(400).json({ error: 'Password not set for this user' });
    }

    const passwordMatch = await bcrypt.compare(password, userData.password);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Optional: Generate and send a token here if using JWT
    // const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: '1h' });

    return res.status(200).json({
      message: 'Login successful',
      // token, // uncomment if JWT is used
    });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



router.post("/google_sign", async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "Google ID token is required" });
  }

  try {
    // 1. Verify Google Token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: "729103709945-mnsfpogikq7o3q6luq6oj8619m2icrba.apps.googleusercontent.com", // Replace with your Google Client ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    if (!email) {
      return res.status(400).json({ error: "Email not found in Google token" });
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(email);
    const userDoc = await userRef.get();

    // 2. Create user if not exists
    if (!userDoc.exists) {
      await userRef.set({
        name: name || "",
        email,
        phone: email,
        referral_code: "",
        is_mail_user: true,
        is_verified: true,
        auth_provider: "google",
        profile_picture: picture || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 3. Get full user data
    const updatedDoc = await userRef.get();
    const userData = updatedDoc.data();

    return res.status(200).json({
      message: "Google Sign-In successful",
      user: userData,
    });

  } catch (error) {
    console.error("Google Sign-In error:", error);
    return res.status(500).json({ error: "Failed to verify Google token" });
  }
});

router.post('/userStats', async (req, res) => {
    const email = req.body;
  try {
     if (!email) {
      return res.status(400).json({error : "Invalid Input"});
    }

    const docRef = db.collection("users").doc(email);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({ data: docSnap.data() });
  } catch (error) {

    console.error("Error fetching user:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/save-address", async (req, res) => {
  try {
    const {
      userId,        // email or phone  // true or false
      address        // entire address object from Flutter
    } = req.body;

    if (!userId || !address) {
      return res.status(400).json({ error: "userId and address are required" });
    }

    const db = admin.firestore();
    const docId = userId;
    const userRef = db.collection("users").doc(docId);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await userRef.update({
      savedAdress: admin.firestore.FieldValue.arrayUnion(address)
    });

    res.status(200).json({ message: "Address saved successfully" });
  } catch (error) {
    console.error("Error saving address:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/delete-address", async (req, res) => {
  try {
    const {
      userId,    // email or phone
      address    // entire address object from Flutter
    } = req.body;

    if (!userId || !address) {
      return res.status(400).json({ error: "userId and address are required" });
    }

    const db = admin.firestore();
    const docId = userId;
    const userRef = db.collection("users").doc(docId);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await userRef.update({
      savedAdress: admin.firestore.FieldValue.arrayRemove(address)
    });

    res.status(200).json({ message: "Address deleted successfully" });
  } catch (error) {
    console.error("Error deleting address:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const bucket = admin.storage().bucket();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/save-payment-details", upload.single("qrCode"), async (req, res) => {
  const db = admin.firestore();
  try {
    const { userId, upiId, phoneNumber } = req.body;
    const file = req.file;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    let qrCodeUrl = null;

    // Handle QR upload
    if (file) {
      const blob = bucket.file(`upi_qr_codes/${Date.now()}_${file.originalname}`);
      const blobStream = blob.createWriteStream({ resumable: false });

      blobStream.end(file.buffer);

      await new Promise((resolve, reject) => {
        blobStream.on("finish", resolve);
        blobStream.on("error", reject);
      });

      // Make file public (optional)
      await blob.makePublic();
      qrCodeUrl = blob.publicUrl();
    }

    // Save to Firestore
    const docRef = db.collection("paymentDetails").doc(userId);
    await docRef.set(
      {
        qrCodeUrl: qrCodeUrl || null,
        upiId: upiId || null,
        phoneNumber: phoneNumber || null,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    res.status(200).json({ message: "Payment details saved successfully" });
  } catch (err) {
    console.error("Error saving payment details:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.post("/add_to_bin",upload.none(),  async (req, res) => {
  try {
    const { userId, scraps: scrapsString } = req.body;
    // const files = req.files;

    let scraps;
    try {
      scraps = JSON.parse(scrapsString);
      console.log(scrapsString);
    } catch (e) {
      return res.status(400).json({ 
        error: "Invalid scraps format",
        details: "scraps should be a JSON string array"
      });
    }

    if (!userId || !scraps || !Array.isArray(scraps) || scraps.length === 0) {
      return res.status(400).json({ 
        error: "Missing required fields",
        required: ["userId", "scraps (array with at least one item)", "notes"]
      });
    }

    for (const scrap of scraps) {
      if (!scrap.id || !scrap.name || !scrap.ratePerKg || !scrap.quantity) {
        return res.status(400).json({ 
          error: "Each scrap item must have id, name, ratePerKg, and quantity",
          invalidItem: scrap
        });
      }

      if (scrap.quantity < 1) {
        return res.status(400).json({
          error: "Minimum quantity is 1kg",
          minQuantity: 1,
          invalidItem: scrap
        });
      }
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const timestamp = admin.firestore.Timestamp.now();

    // Upload all images and collect URLs
    // const imageUrls = [];

    // for (let i = 0; i < files.length; i++) {
    //   const file = files[i];
    //   const fileName = `bin_images/${userId}/${Date.now()}_${file.originalname}`;
    //   const fileRef = bucket.file(fileName);

    //   await new Promise((resolve, reject) => {
    //     const blobStream = fileRef.createWriteStream({
    //       metadata: {
    //         contentType: file.mimetype
    //       }
    //     });

    //     blobStream.on('error', reject);
    //     blobStream.on('finish', async () => {
    //       try {
    //         await fileRef.makePublic();
    //         imageUrls.push(`https://storage.googleapis.com/${bucket.name}/${fileName}`);
    //         resolve();
    //       } catch (err) {
    //         reject(err);
    //       }
    //     });

    //     blobStream.end(file.buffer);
    //   });
    // }

    // Create scrap items (without image)
    const scrapItems = scraps.map((scrap) => ({
      scrapItemID: `scrap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      scrapType: {
        id: scrap.id,
        name: scrap.name,
        ratePerKg: scrap.ratePerKg,
        category: scrap.category || '',
        unit: scrap.unit || 'kg',
        quantity: scrap.quantity,
        scrapImage : scrap.scrapImage
      },
      status: "in_bin",
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    // Update user bin
    await userRef.update({
      bin: scrapItems,
      // binImages: imageUrls,
      // binNotes: notes
    });

    res.status(201).json({ 
      message: "Scraps added to bin successfully",
      scraps: scrapItems,
      // binImages: imageUrls,
      // binNotes: notes
    });

  } catch (err) {
    console.error("Error in /add_to_bin:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

router.post("/upload_scrap_image", upload.single("image"), async (req, res) => {
  try {
    const { userId, scrapItemID } = req.body;
    const file = req.file;

    if (!userId || !scrapItemID || !file) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["userId", "scrapItemID", "image (multipart)"]
      });
    }

    console.log("A");
    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    
    console.log("B");
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    
    console.log("C");

    const userData = userDoc.data();
    const bin = userData.bin || [];

    
    // Find the scrap item
    const index = bin.findIndex(item => item.scrapItemID === scrapItemID);
    if (index === -1) {
      return res.status(404).json({ error: "Scrap item not found in user bin" });
    }
    
    console.log("d");

    // Upload image to Firebase Storage
    const fileName = `scrap_images/${userId}/${Date.now()}_${file.originalname}`;
    const fileRef = bucket.file(fileName);

    await new Promise((resolve, reject) => {
      const stream = fileRef.createWriteStream({
        metadata: {
          contentType: file.mimetype
        }
      });

      stream.on("error", reject);
      stream.on("finish", async () => {
        try {
          await fileRef.makePublic(); // Optional: only if you want public access
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      stream.end(file.buffer);
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Update the image URL in the user's bin
    bin[index].scrapType.scrapImage = publicUrl;
    bin[index].updatedAt = admin.firestore.Timestamp.now();

    await userRef.update({ bin });

    return res.status(200).json({
      message: "Scrap image uploaded successfully",
      scrapItemID,
      imageUrl: publicUrl
    });

  } catch (err) {
    console.error("Error uploading scrap image:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

router.post("/update_scrap_quantity", async (req, res) => {
  try {
    const { userId, scrapItemID, quantity } = req.body;

    // Basic validations
    if (!userId || !scrapItemID || quantity === undefined) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["userId", "scrapItemID", "quantity"]
      });
    }

    if (isNaN(quantity) || quantity < 1) {
      return res.status(400).json({
        error: "Quantity must be a number >= 1kg",
        value: quantity
      });
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    const bin = userData.bin || [];

    const index = bin.findIndex(item => item.scrapItemID === scrapItemID);
    if (index === -1) {
      return res.status(404).json({ error: "Scrap item not found in bin" });
    }

    // Update quantity
    bin[index].scrapType.quantity = quantity;
    bin[index].updatedAt = admin.firestore.Timestamp.now();

    await userRef.update({ bin });

    return res.status(200).json({
      message: "Scrap quantity updated successfully",
      scrapItemID,
      newQuantity: quantity
    });

  } catch (err) {
    console.error("Error in /update_scrap_quantity:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

router.post('/get_bin_items', async (req, res) => {
  try {
    const { userId } = req.body;

    // Validate required fields
    if (!userId) {
      return res.status(400).json({ 
        error: "Missing required field",
        required: ["userId"]
      });
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: "User not found" 
      });
    }

    const userData = userDoc.data();
    const binItems = userData.bin || [];
    // const binNotes =  userData.binNotes;

    // Convert Firestore Timestamps to JavaScript Dates
    const formattedBinItems = binItems.map(item => {
      return {
        ...item,
        createdAt: item.createdAt?.toDate()?.toISOString(),
        updatedAt: item.updatedAt?.toDate()?.toISOString(),
        // Convert nested timestamps if they exist
        scrapType: {
          ...item.scrapType,
          // Add any timestamp conversions for scrapType if needed
        },
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedBinItems.length,
      binItems: formattedBinItems
    });

  } catch (e) {
    console.error("Error fetching bin items:", e);
    return res.status(500).json({ 
      success: false,
      error: "Failed to fetch bin items",
      details: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

router.post("/remove_from_bin", async (req, res) => {
  console.log("Starting remove_from_bin operation");
  
  try {
    const { userId, scrapItemId } = req.body;

    // Enhanced validation with logging
    console.log(`Validating request for userId: ${userId}, scrapItemId: ${scrapItemId}`);
    
    if (!userId || !scrapItemId) {
      console.error("Missing required fields in request");
      return res.status(400).json({ 
        success: false,
        error: "Missing required fields",
        required: ["userId", "scrapItemId"],
        received: {
          userId: !!userId,
          scrapItemId: !!scrapItemId
        }
      });
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);

    // Get current user data
    console.log(`Fetching user document for ${userId}`);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.error(`User not found: ${userId}`);
      return res.status(404).json({ 
        success: false,
        error: "User not found",
        userId
      });
    }

    const userData = userDoc.data();
    const currentBin = userData.bin || [];
    console.log(`Current bin has ${currentBin.length} items`);

    // Find the item to remove using the correct ID field name
    const itemIndex = currentBin.findIndex(item => item.scrapItemID === scrapItemId);
    
    if (itemIndex === -1) {
      console.error(`Scrap item not found in bin: ${scrapItemId}`);
      console.log("Available item IDs:", currentBin.map(item => item.scrapItemID));
      return res.status(404).json({ 
        success: false,
        error: "Scrap item not found in bin",
        scrapItemId,
        availableItems: currentBin.map(item => ({
          id: item.scrapItemID,
          name: item.scrapType?.name,
          quantity: item.quantity
        }))
      });
    }

    const itemToRemove = currentBin[itemIndex];
    console.log(`Found item to remove: ${JSON.stringify({
      id: itemToRemove.scrapItemID,
      name: itemToRemove.scrapType?.name,
      quantity: itemToRemove.quantity
    })}`);

    // Remove the item from the bin
    console.log("Attempting to remove item from Firestore");
    await userRef.update({
      bin: admin.firestore.FieldValue.arrayRemove(itemToRemove)
    });

    // Delete associated images from storage (if they exist)
    if (itemToRemove.images && itemToRemove.images.length > 0) {
      console.log(`Attempting to delete ${itemToRemove.images.length} images from storage`);
      try {
        await Promise.all(
          itemToRemove.images.map(async (imageUrl) => {
            try {
              const matches = imageUrl.match(/scrap_images\/.+/);
              if (matches && matches[0]) {
                const file = bucket.file(matches[0]);
                await file.delete();
                console.log(`Deleted image: ${matches[0]}`);
              }
            } catch (imageError) {
              console.error(`Error deleting image ${imageUrl}:`, imageError);
              // Continue with other images even if one fails
            }
          })
        );
      } catch (batchError) {
        console.error("Batch image deletion error:", batchError);
      }
    }

    console.log("Successfully removed item from bin");
    res.status(200).json({ 
      success: true,
      message: "Scrap item removed from bin successfully",
      removedItem: {
        id: itemToRemove.scrapItemID,
        name: itemToRemove.scrapType?.name,
        quantity: itemToRemove.quantity,
        images: itemToRemove.images || []
      },
      remainingItems: currentBin.length - 1
    });

  } catch (e) {
    console.error("Critical error in remove_from_bin:", e);
    res.status(500).json({ 
      success: false,
      error: "Internal Server Error",
      message: "Failed to remove item from bin",
      details: process.env.NODE_ENV === 'development' ? e.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  } finally {
    console.log("Completed remove_from_bin operation");
  }
});

router.post("/get_user_bin", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      console.log("something missing");
      return res.status(400).json({ error: "userId is required" });
    }

    console.log(" a");

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    const binItems = userData.bin || []; // Return empty array if bin doesn't exist

    console.log(" I have returned the data " + binItems.length);
    res.status(200).json({ bin: binItems });
  } catch (e) {
    console.error("Error getting user bin:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put('/users/:email', async (req, res) => {
  try {
    const userEmail = req.params.email;
    const {
      name,
      phone,
      is_verified,
      walletAmount,
      savedAddress,
      referral_code
    } = req.body;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const userRef = db.collection('users').doc(userEmail);
    const doc = await userRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (typeof is_verified === 'boolean') updateData.is_verified = is_verified;
    if (walletAmount !== undefined) {
      updateData.walletAmount = Number(walletAmount);
      updateData.wallet_amount = Number(walletAmount); 
    }
    if (savedAddress) {
      if (!Array.isArray(savedAddress)) {
        return res.status(400).json({ error: 'savedAddress must be an array' });
      }
      updateData.savedAddress = savedAddress;
    }
    if (referral_code) updateData.referral_code = referral_code;

    await userRef.update(updateData);

    const updatedDoc = await userRef.get();

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: {
        email: updatedDoc.id,
        ...updatedDoc.data()
      }
    });

  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({
      error: 'Failed to update user',
      details: error.message
    });
  }
});

router.delete('/users/:email', async (req, res) => {
  try {
    const userEmail = req.params.email;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user exists
    const userRef = db.collection('users').doc(userEmail);
    const doc = await userRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has any orders
    const userData = doc.data();
    if (userData.orders && userData.orders.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete user with existing orders',
        orderCount: userData.orders.length
      });
    }
    await userRef.delete();

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      deletedUserEmail: userEmail
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({
      error: 'Failed to delete user',
      details: error.message
    });
  }
});

router.get('/notification/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        const notificationsSnapshot = await admin.firestore()
            .collection('users')
            .doc(userId)
            .collection('notifications')
            .get();
        
        const notifications = [];
        notificationsSnapshot.forEach(doc => {
            notifications.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        // Sort by createdAt (newest first)
        notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.status(200).json({
            success: true,
            count: notifications.length,
            data: notifications
        });
        console.log("fetching all the notification");
    } catch (error) {
        console.error('Error fetching user notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications',
                        error: error.message
        });
    }
});

router.delete('/delete_account', async (req, res) => {
  const userEmail = req.query.userId;

  if (!userEmail) {
    return res.status(400).json({ error: 'Missing userId (email) in query params' });
  }

  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(userEmail);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found in Firestore' });
    }

    // 🔥 Delete subcollections (e.g., addresses, notifications)
    const subcollections = ['addresses', 'notifications'];
    for (const sub of subcollections) {
      const subColRef = userRef.collection(sub);
      const subDocs = await subColRef.listDocuments();
      const batch = db.batch();

      subDocs.forEach(doc => batch.delete(doc));
      if (subDocs.length > 0) {
        await batch.commit();
      }
    }

    // 🔥 Delete Firestore user document
    await userRef.delete();

    // 🔥 Delete Firebase Auth user by email
    const userRecord = await admin.auth().getUserByEmail(userEmail);
    await admin.auth().deleteUser(userRecord.uid);

    return res.status(200).json({ message: `User ${userEmail} deleted successfully` });

  } catch (err) {
    console.error('Error deleting account:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.post('/verify_phone_otp', async (req, res) => {
  const { phoneNumber, verificationCode } = req.body;

  if (!phoneNumber || !verificationCode) {
    return res.status(400).json({ error: 'Phone number and verification code are required' });
  }

  try {
    const db = admin.firestore();
    const verificationDoc = await db.collection('phoneResetVerifications').doc(phoneNumber).get();
    
    if (!verificationDoc.exists) {
      return res.status(400).json({ error: 'No verification request found for this phone number' });
    }

    const verificationData = verificationDoc.data();
    
    // Check if expired
    if (Date.now() > verificationData.expiresAt) {
      await verificationDoc.ref.delete();
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    // Verify the code with Firebase Auth
    const credential = firebase.auth.PhoneAuthProvider.credential(
      verificationData.verificationId,
      verificationCode
    );
    
    await firebase.auth().signInWithCredential(credential);
    
    // Verification successful - delete the verification record
    await verificationDoc.ref.delete();
    
    // Return the associated email for password reset
    return res.status(200).json({ 
      message: 'Phone number verified successfully',
      email: verificationData.email,
      canResetPassword: true
    });
  } catch (error) {
    console.error('Error verifying phone OTP:', error);
    if (error.code === 'auth/invalid-verification-code') {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post("/forgot_password", async (req, res) => {
  const { email, phoneNumber } = req.body;

  if (!email && !phoneNumber) {
    return res.status(400).json({ error: 'Email or phone number is required' });
  }

  try {
    if (email) {
      // Email flow - use existing send_otp endpoint
      console.log("Initiating email password reset");
      // You might want to first check if email exists in your users collection
      const db = admin.firestore();
      const userDoc = await db.collection('users').doc(email).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Get user name for the email
      const userData = userDoc.data();
      const name = userData.name || '';
      
      // Call your existing send_otp logic
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
      
      await db.collection('emailOtps').doc(email).set({
        otp,
        expiresAt,
      });
      
      // Send email
      const mailOptions = {
        from: 'Scrap It Scrapit@gmail.com',
        to: email,
        subject: 'ScrapIt Password Reset',
        text: `Hello ${name},\n\nYour password reset OTP is ${otp}. It is valid for 5 minutes.\n\nIf you didn't request this, please ignore this email.\n\nThanks,\nScrap It Team`,
      };

      await transporter.sendMail(mailOptions);
      return res.status(200).json({ message: 'OTP sent to email' });
    } else if (phoneNumber) {
      // Phone number flow - use Firebase Auth
      console.log("Initiating phone number password reset");
      
      // First check if phone number exists in your users collection
      const db = admin.firestore();
      const usersRef = db.collection('users');
      const snapshot = db.collection('users').doc(phoneNumber)
      
      if (snapshot.empty) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Get the user's email (assuming you store phone numbers with emails)
      let userEmail = null;
      // snapshot.forEach(doc => {
      //   userEmail = doc.id; // assuming doc ID is email
      // });
      
      // if (!userEmail) {
      //   return res.status(404).json({ error: 'User not found' });
      // }
      
      // Send verification code via Firebase Auth
      const appVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container'); // You need to set this up in your frontend
      const confirmationResult = await firebase.auth().signInWithPhoneNumber(phoneNumber, appVerifier);
      
      // Store the verification ID in Firestore temporarily
      await db.collection('phoneResetVerifications').doc(phoneNumber).set({
        verificationId: confirmationResult.verificationId,
        email: phoneNumber, // store associated email for password reset
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes expiry
      });
      
      return res.status(200).json({ 
        message: 'Verification code sent to phone',
        verificationRequired: true 
      });
    }
  } catch (error) {
    console.error('Error in forgot password:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
