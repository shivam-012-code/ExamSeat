require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/exam_db';

// --- SCHEMAS ---

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  created_at: { type: Date, default: Date.now }
});

const StudentSchema = new mongoose.Schema({
  // FIX 1: Type changed to String (supports trim, leading zeroes, and alphanumeric roll numbers)
  reg_no: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  branch: { type: String, trim: true },
  semester: { type: Number }
});

const RoomSchema = new mongoose.Schema({
  room_no: { type: String, required: true, unique: true, trim: true },
  rows: { type: Number, required: true },
  columns: { type: Number, required: true },
  capacity: { type: Number, required: true }
});

const ExamSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true },
  branch: { type: String, trim: true },
  semester: { type: Number },
  room_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  exam_date: { type: Date, required: true },
  start_time: { type: String, required: true },
  end_time: { type: String, required: true }
});

const SeatingSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  exam_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  room_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  row_no: { type: Number, required: true },
  column_no: { type: Number, required: true },
  seat_no: { type: String, required: true }
});

// --- MODELS ---

const User = mongoose.model('User', UserSchema);
const Student = mongoose.model('Student', StudentSchema);
const Room = mongoose.model('Room', RoomSchema);
const Exam = mongoose.model('Exam', ExamSchema);
const Seating = mongoose.model('Seating', SeatingSchema);

// FIX 2: Wrapped in try...catch block to catch connection errors cleanly
async function initDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected successfully.');

    const adminUser = process.env.DEFAULT_ADMIN_USER || 'shivamkumar035wp';
    const adminPass = process.env.DEFAULT_ADMIN_PASS || 'Shivam012@';

    // Check default admin account creation
    const adminExists = await User.findOne({ username: adminUser });
    if (!adminExists) {
      const hashedPw = await bcrypt.hash(adminPass, 10);
      await User.create({ username: adminUser, password: hashedPw, role: 'admin' });
      console.log(`Default Admin Account Created (Username: ${adminUser})`);
    }
  } catch (err) {
    console.error('DB Init Error:', err);
  }
}

module.exports = {
  initDB,
  User,
  Student,
  Room,
  Exam,
  Seating
};