const mongoose = require('mongoose');

const SaleSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true
    },
    invoiceNumber: {
        type: String,
        required: true,
        unique: true
    },
    customerName: {
        type: String,
        required: true
    },
    
    products: [
        {
            item: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'items', // Reference to the item schema
                required: true
            },
            quantity: {
                type: Number,
                required: true,
                min: 1
            },
            price: {
                type: Number,
                required: true,
                min: 0
            },
            discount: {
                type: Number,
                default: 0
            },
            taxRate: {
                type: Number,
                required: true
            },
            total: {
                type: Number,
                required: true // Store calculated total for this product
            }
        }
    ],
    totalAmount: {
        type: Number,
        required: true
    },
    paymentType: {
        type: String,
        enum: ['Cash', 'Credit', 'Online'],
        required: true
    },
    balanceDue: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Sale', SaleSchema);
