const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const admin = require('../../firebase1');

const db = admin.firestore();
const bucket = admin.storage().bucket();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const generateBlogId = (title) => {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50); 
};

router.post('/blogs', upload.array('images', 10), async (req, res) => { 
  try {
    const { title, description } = req.body;
    const imageFiles = req.files;

    if (!title || !description) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['title', 'description']
      });
    }

    if (!imageFiles || imageFiles.length === 0) {
      return res.status(400).json({
        error: 'At least one image is required'
      });
    }

    const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif'];
    for (const file of imageFiles) {
      if (!validMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
          error: 'Invalid image type. Only JPEG, PNG, and GIF are allowed'
        });
      }
    }

    const blogId = generateBlogId(title);
    const imageUrls = [];

    for (const [index, file] of imageFiles.entries()) {
      const imagePath = `blog-images/${blogId}-${Date.now()}-${index}`;
      const fileRef = bucket.file(imagePath);
      
      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype
        }
      });

      await fileRef.makePublic();
      imageUrls.push(`https://storage.googleapis.com/${bucket.name}/${imagePath}`);
    }

    const blogData = {
      title,
      description,
      images: imageUrls, // Array of image URLs
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('blogs').doc(blogId).set(blogData);

    return res.status(201).json({
      success: true,
      message: 'Blog created successfully with multiple images',
      blogId,
      blogData
    });

  } catch (error) {
    console.error('Error creating blog:', error);
    return res.status(500).json({
      error: 'Failed to create blog',
      details: error.message
    });
  }
});

router.get('/blogs', async (req, res) => {
  try {
    if (req.query.blogId) {
      const doc = await db.collection('blogs').doc(req.query.blogId).get();
      
      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Blog not found'
        });
      }
      
      return res.status(200).json({
        success: true,
        blog: {
          id: doc.id,
          ...doc.data()
        }
      });
    }

    const snapshot = await db.collection('blogs')
      .orderBy('createdAt', 'desc')
      .get();
    
    const blogs = [];
    snapshot.forEach(doc => {
      blogs.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return res.status(200).json({
      success: true,
      count: blogs.length,
      blogs
    });
    
  } catch (error) {
    console.error('Error fetching blogs:', error);
    return res.status(500).json({
      error: 'Failed to fetch blogs',
      details: error.message
    });
  }
});

router.delete('/blogs/:blogId', async (req, res) => {
  try {
    const blogId = req.params.blogId;
    const doc = await db.collection('blogs').doc(blogId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ 
        error: 'Blog not found' 
      });
    }

    const blogData = doc.data();
    if (blogData.images && blogData.images.length > 0) {
      const deletePromises = blogData.images.map(imageUrl => {
        const baseUrl = `https://storage.googleapis.com/${bucket.name}/`;
        if (imageUrl.startsWith(baseUrl)) {
          const filePath = imageUrl.replace(baseUrl, '');
          return bucket.file(decodeURIComponent(filePath)).delete();
        }
        return Promise.resolve();
      });
      await Promise.all(deletePromises);
    }

    await db.collection('blogs').doc(blogId).delete();
    
    return res.status(200).json({
      success: true,
      message: 'Blog and all its images deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting blog:', error);
    return res.status(500).json({
      error: 'Failed to delete blog',
      details: error.message
    });
  }
});

module.exports = router;