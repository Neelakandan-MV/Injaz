const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
    itemName: { type: String, required: true, trim: true },
    itemHSN: { type: String, required: true, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'categories', required: true, trim: true },
    unit: { type: String, required: true, trim: true },
    image: { type: Array, required: false },
    salePrice: { type: Number, required: true, min: 0 },
    salePriceTaxIncluded: { type: Boolean, default: false },
    discount: {
        type: {
            value: { type: Number, required: false },
            discountType: { type: String, required: false },
        },
        required: false
    },
    wholesalePrice: { type: Number, required: false, min: 0 },
    purchasePrice: { type: Number, required: true, min: 0 },
    purchasePriceTaxIncluded: { type: Boolean, default: false },
    taxRate: { type: String, required: true },
    itemCode: { type: String, required: false, unique: true, trim: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('items', itemSchema);
