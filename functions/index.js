const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const admin = require("firebase-admin");


initializeApp();

exports.sendOrderNotifications = onDocumentWritten(
  "orders/{orderId}",
  async (event) => {
    const orderId = event.params.orderId;
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    const userEmail = afterData.userId;
    const pickupId = afterData.pickupId;

    // 🔍 Get user and FCM token
    const userSnapshot = await getFirestore()
      .collection("users")
      .where("email", "==", userEmail)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      console.log("User not found");
      return null;
    }

    const userDoc = userSnapshot.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    const fcmToken = userData.fcm;

    if (!fcmToken) {
      console.log("No FCM token for user");
      return null;
    }

    const firestore = getFirestore();

    // 🔔 Save to notifications
    const saveNotification = async (title, body, type) => {
      await firestore
        .collection("users")
        .doc(userId)
        .collection("notifications")
        .add({
          title,
          body,
          type,
          orderId,
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          data: { orderId, type }
        });
    };

    // 📅 Save to reminders
    const saveReminder = async (title, body, type) => {
      await firestore
        .collection("users")
        .doc(userId)
        .collection("reminders")
        .add({
          title,
          body,
          type,
          orderId,
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          data: { orderId, type }
        });
    };

    // ✅ Handle order status change
    if (beforeData && beforeData.status !== afterData.status) {
      const message = {
        notification: {
          title: "Order Status Updated",
          body: `Your order ${pickupId} is now ${afterData.status}`
        },
        data: {
          orderId,
          type: "statusChange",
          click_action: "FLUTTER_NOTIFICATION_CLICK"
        },
        token: fcmToken
      };

      await getMessaging().send(message);
      await saveNotification(
        "Order Status Updated",
        `Your order ${orderId} is now ${afterData.status}`,
        "statusChange"
      );
    }

    // ✅ Handle pickup reminder
    if (
      (!beforeData || beforeData.pickupDate !== afterData.pickupDate) &&
      afterData.pickupDate
    ) {
      const message = {
        notification: {
          title: "Pickup Reminder",
          body: `Your order ${pickupId} is scheduled for pickup on ${afterData.pickupDate}`
        },
        data: {
          orderId,
          type: "pickUpReminder",
          click_action: "FLUTTER_NOTIFICATION_CLICK"
        },
        token: fcmToken
      };

      await getMessaging().send(message);
      await saveReminder(
        "Pickup Reminder",
        `Your order ${orderId} is scheduled for pickup on ${afterData.pickupDate}`,
        "pickUpReminder"
      );
    }
    return null;
  }
);
