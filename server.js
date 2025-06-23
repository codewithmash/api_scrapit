const express = require('express');
const app = express();
const cors = require('cors');
const authRoutes = require('./routes/auth');
const userRoutes  = require('./routes/user_routes');
const scrapRoutes = require('./routes/scraproutes');
const enquiries = require("./routes/enquiries")
const adminRoutes  =  require("./routes/admin/dashboardRoutes");
const zones =  require("./routes/admin/zones");
const admin  = require("./firebase1");
const blogs =  require("./routes/admin/blogs");
const orders = require("./routes/orders/order")
const partner = require("./routes/partner/dashboardRoutes");
const db = admin.firestore();

app.use(cors());
app.use(express.json());
app.use('/api', authRoutes);
app.use('/userapi',userRoutes);
app.use('/scraps', scrapRoutes);
app.use('/enquiries',enquiries);
app.use('/admin',adminRoutes);
app.use('/admin/available',zones);
app.use('/blogs',blogs);
app.use('/api',orders);
app.use("/partners",partner);
app.get('/api/total-scrapped', async (req, res) => {
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    let totalScrappedSum = 0;
    
    snapshot.forEach(doc => {
      const userData = doc.data();
      totalScrappedSum += userData.totalScrapped || 0;
    });

    res.status(200).json({ success: true, totalScrappedSum });
  } catch (error) {
    console.error("Error fetching totalScrapped sum:", error);
    res.status(500).json({ success: false, error: "Failed to calculate sum" });
  }

});
const PORT = 3006;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));