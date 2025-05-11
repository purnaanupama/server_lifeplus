const express = require('express');
const axios = require('axios');
const cors = require('cors');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_SECRET;
const BASE = 'https://api-m.sandbox.paypal.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://192.168.63.173:5000';

// Get PayPal access token
const getPayPalAccessToken = async () => {
  try {
    const auth = await axios({
      url: `${BASE}/v1/oauth2/token`,
      method: 'post',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en_US',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: CLIENT,
        password: SECRET,
      },
      data: 'grant_type=client_credentials',
    });
    return auth.data.access_token;
  } catch (error) {
    console.error('Error getting PayPal access token:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with PayPal');
  }
};

// Create PayPal order
app.post('/create-order', async (req, res) => {
  try {
    // Get payment details from request body if provided
    const { amount = '10.00', currency = 'USD', description = 'Medical Appointment' } = req.body;
    
    const accessToken = await getPayPalAccessToken();

    const order = await axios.post(
      `${BASE}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        application_context: {
          return_url: `${APP_BASE_URL}/capture-order`,
          cancel_url: `${APP_BASE_URL}/cancel-order`,
          user_action: 'PAY_NOW', // Force immediate payment without review step
          brand_name: 'Healthcare App',
          shipping_preference: 'NO_SHIPPING'
        },
        purchase_units: [
          {
            amount: {
              currency_code: currency,
              value: amount,
            },
            description: description
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('PayPal order created:', order.data.id);
    res.json({ 
      id: order.data.id, 
      status: order.data.status,
      approve: order.data.links.find(l => l.rel === 'approve').href 
    });
  } catch (err) {
    console.error('Error creating order:', err.response?.data || err.message);
    res.status(500).json({ 
      error: true, 
      message: 'Failed to create PayPal order',
      details: err.response?.data || err.message
    });
  }
});

// Capture payment after user approval
app.get('/capture-order', async (req, res) => {
  try {
    const { token } = req.query; // PayPal returns a token
    if (!token) {
      return res.status(400).send('Missing order token');
    }

    // Find the order ID from the token
    const accessToken = await getPayPalAccessToken();
    
    // Get order details
    const orderDetails = await axios.get(
      `${BASE}/v2/checkout/orders/${token}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Capture the payment to complete the transaction
    const captureResponse = await axios.post(
      `${BASE}/v2/checkout/orders/${token}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Payment captured:', captureResponse.data.id);
    
    // Create a simple HTML response that redirects back to the app
    res.send(`
      <html>
        <head>
          <title>Payment Successful</title>
          <meta http-equiv="refresh" content="3;url=yourapp://payment-success" />
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; }
            .success { color: green; }
          </style>
        </head>
        <body>
          <h1 class="success">Payment Successful!</h1>
          <p>Your appointment has been booked successfully.</p>
          <p>Redirecting back to the app...</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error capturing payment:', err.response?.data || err.message);
    res.status(500).send(`
      <html>
        <head>
          <title>Payment Error</title>
          <meta http-equiv="refresh" content="5;url=yourapp://payment-error" />
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; }
            .error { color: red; }
          </style>
        </head>
        <body>
          <h1 class="error">Payment Processing Error</h1>
          <p>There was an error processing your payment.</p>
          <p>Redirecting back to the app...</p>
        </body>
      </html>
    `);
  }
});

// Handle cancelled payment
app.get('/cancel-order', (req, res) => {
  console.log('Payment cancelled by user');
  res.send(`
    <html>
      <head>
        <title>Payment Cancelled</title>
        <meta http-equiv="refresh" content="3;url=yourapp://payment-cancelled" />
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; }
        </style>
      </head>
      <body>
        <h1>Payment Cancelled</h1>
        <p>You've cancelled the payment process.</p>
        <p>Redirecting back to the app...</p>
      </body>
    </html>
  `);
});

// Webhook endpoint for PayPal events (recommended for production)
app.post('/paypal-webhook', express.raw({type: 'application/json'}), (req, res) => {
  // Process webhook events (payment completed, payment failed, etc.)
  console.log('Received PayPal webhook event');
  
  // In production, verify the webhook signature for security
  
  res.status(200).send('OK');
});

// Generate prescription PDF
app.post('/generate-prescription-pdf', async (req, res) => {
  try {
    const { patientData, doctorName, prescriptions, vitals } = req.body;
    
    if (!patientData || !doctorName || !prescriptions || !vitals) {
      return res.status(400).json({ error: 'Missing required fields for prescription' });
    }
    
    // Create a PDF document
    const doc = new PDFDocument();
    const chunks = [];
    
    doc.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    doc.on('end', () => {
      const result = Buffer.concat(chunks);
      const base64Data = result.toString('base64');
      res.json({ base64Data });
    });
    
    // Add content to PDF
    doc.fontSize(20).text('Medical Prescription', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    
    // Patient details
    doc.fontSize(16).text('Patient Details', { underline: true });
    doc.fontSize(12).text(`Name: ${patientData.name || 'N/A'}`);
    doc.fontSize(12).text(`Age: ${patientData.age || 'N/A'}`);
    doc.fontSize(12).text(`Injury/Disease: ${patientData.purpose || 'N/A'}`);
    doc.moveDown();
    
    // Doctor details
    doc.fontSize(16).text('Doctor', { underline: true });
    doc.fontSize(12).text(`Dr. ${doctorName}`);
    doc.moveDown();
    
    // Vitals
    doc.fontSize(16).text('Vitals', { underline: true });
    doc.fontSize(12).text(`Blood Pressure: ${vitals.blood_pressure || 'N/A'}`);
    doc.fontSize(12).text(`Blood Sugar: ${vitals.blood_sugar || 'N/A'}`);
    doc.fontSize(12).text(`Body Temperature: ${vitals.body_temperature || 'N/A'}`);
    doc.moveDown();
    
    // Prescriptions
    doc.fontSize(16).text('Prescriptions', { underline: true });
    if (Array.isArray(prescriptions) && prescriptions.length > 0) {
      prescriptions.forEach((item, index) => {
        doc.fontSize(12).text(`${index + 1}. ${item.prescription || item}`);
      });
    } else {
      doc.fontSize(12).text('No prescriptions provided');
    }
    
    // Add footer
    doc.moveDown(2);
    doc.fontSize(12).text('Signature: ____________________', { align: 'right' });
    
    // Finalize the PDF
    doc.end();
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ 
      error: true, 
      message: 'Error generating PDF',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`));