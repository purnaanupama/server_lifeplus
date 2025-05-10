const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_SECRET;
const BASE = 'https://api-m.sandbox.paypal.com';

app.post('/create-order', async (req, res) => {
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

    const accessToken = auth.data.access_token;

    const order = await axios.post(
      `${BASE}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: {
              currency_code: 'USD',
              value: '10.00',
            },
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

    res.json({ id: order.data.id, approve: order.data.links.find(l => l.rel === 'approve').href });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).send('Something went wrong');
  }
});

// Add this new endpoint to your existing backend code

// Install required packages:
// npm install pdfkit fs-extra

app.post('/generate-prescription-pdf', async (req, res) => {
  try {
    const { patientData, doctorName, prescriptions, vitals } = req.body;
    
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
    doc.fontSize(20).text('Prescription', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    
    // Patient details
    doc.fontSize(16).text('Patient Details', { underline: true });
    doc.fontSize(12).text(`Name: ${patientData.name}`);
    doc.fontSize(12).text(`Age: ${patientData.age}`);
    doc.fontSize(12).text(`Injury/Disease: ${patientData.purpose}`);
    doc.moveDown();
    
    // Doctor details
    doc.fontSize(16).text('Doctor', { underline: true });
    doc.fontSize(12).text(`Dr. ${doctorName}`);
    doc.moveDown();
    
    // Vitals
    doc.fontSize(16).text('Vitals', { underline: true });
    doc.fontSize(12).text(`Blood Pressure: ${vitals.blood_pressure}`);
    doc.fontSize(12).text(`Blood Sugar: ${vitals.blood_sugar}`);
    doc.fontSize(12).text(`Body Temperature: ${vitals.body_temperature}`);
    doc.moveDown();
    
    // Prescriptions
    doc.fontSize(16).text('Prescriptions', { underline: true });
    prescriptions.forEach((item, index) => {
      doc.fontSize(12).text(`${index + 1}. ${item.prescription}`);
    });
    
    // Add footer
    doc.moveDown(2);
    doc.fontSize(12).text('Signature: ____________________', { align: 'right' });
    
    // Finalize the PDF
    doc.end();
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send('Error generating PDF');
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
