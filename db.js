require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/exam_db';

// --- SCHEMAS ---

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  email: { type: String, trim: true, default: '' },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  created_at: { type: Date, default: Date.now }
});

const StudentSchema = new mongoose.Schema({
  reg_no: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  branch: { type: String, trim: true },
  semester: { type: Number }
});

const RoomSchema = new mongoose.Schema({
  room_no: { type: String, required: true, unique: true, trim: true },
  rows: { type: Number, default: 0 },
  columns: { type: Number, required: true },
  column_rows: [{ type: Number, required: true }],
  active_seats: [{ type: String }],
  seat_colors: [{
    seat_key: { type: String },
    color: { type: String, default: 'color1' }
  }],
  capacity: { type: Number, required: true }
});

const ExamSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true },
  branch: { type: String, trim: true },
  semester: { type: Number },
  room_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
  // Snapshot of the room's seat layout at the exact moment this exam was created
  room_snapshot: {
    room_no: { type: String, default: '' },
    rows: { type: Number, default: 0 },
    columns: { type: Number, default: 0 },
    column_rows: [{ type: Number }],
    active_seats: [{ type: String }],
    seat_colors: [{
      seat_key: { type: String },
      color: { type: String, default: 'color1' }
    }],
    capacity: { type: Number, default: 0 }
  },
  seat_color: { type: String, default: 'color1' },
  start_reg_no: { type: String, trim: true, default: '' },
  stop_reg_no: { type: String, trim: true, default: '' },
  exam_date: { type: Date, required: true },
  start_time: { type: String, required: true },
  end_time: { type: String, required: true },
  question_paper: { type: String, default: '' }
});

const SeatingSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  exam_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  room_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  row_no: { type: Number, required: true },
  column_no: { type: Number, required: true },
  seat_no: { type: String, required: true }
});

const MarkSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  exam_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  marks_obtained: { type: Number, required: true },
  total_marks: { type: Number, default: 20 },
  question_wise_marks: { type: Map, of: Number, default: {} }
});

const PyqSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  branch: { type: String, required: true, trim: true },
  semester: { type: Number, required: true },
  subject: { type: String, required: true, trim: true },
  file_url: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

const PyqProgressSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  pyq_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Pyq', required: true },
  is_completed: { type: Boolean, default: false }
});
PyqProgressSchema.index({ student_id: 1, pyq_id: 1 }, { unique: true });

const McqSchema = new mongoose.Schema({
  branch: { type: String, required: true, trim: true },
  semester: { type: Number, required: true },
  subject: { type: String, default: 'General', trim: true },
  question: { type: String, required: true, trim: true },
  options: [{
    option_id: { type: Number, required: true },
    text: { type: String, required: true, trim: true }
  }],
  correct_options: [{ type: Number, required: true }],
  is_multiple: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

const McqVoteSchema = new mongoose.Schema({
  mcq_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Mcq', required: true },
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  reg_no: { type: String, required: true, trim: true },
  student_name: { type: String, required: true, trim: true },
  selected_options: [{ type: Number, required: true }],
  is_correct: { type: Boolean, required: true },
  submitted_at: { type: Date, default: Date.now }
});
McqVoteSchema.index({ mcq_id: 1, student_id: 1 }, { unique: true });

const ChatMessageSchema = new mongoose.Schema({
  branch: { type: String, required: true, trim: true },
  semester: { type: Number, required: true },
  sender_username: { type: String, required: true },
  sender_name: { type: String, required: true },
  sender_role: { type: String, enum: ['admin', 'student'], default: 'student' },
  message: { type: String, required: true, trim: true },
  created_at: { type: Date, default: Date.now, expires: 86400 }
});

const PollSchema = new mongoose.Schema({
  branch: { type: String, required: true, trim: true },
  semester: { type: Number, required: true },
  question: { type: String, required: true, trim: true },
  options: [{
    option_id: { type: Number, required: true },
    text: { type: String, required: true, trim: true }
  }],
  is_multiple: { type: Boolean, default: false },
  created_by: { type: String, default: 'Admin' },
  created_at: { type: Date, default: Date.now, expires: 172800 }
});

const PollVoteSchema = new mongoose.Schema({
  poll_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Poll', required: true },
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  reg_no: { type: String, required: true, trim: true },
  student_name: { type: String, required: true, trim: true },
  selected_options: [{ type: Number, required: true }],
  voted_at: { type: Date, default: Date.now, expires: 172800 }
});
PollVoteSchema.index({ poll_id: 1, student_id: 1 }, { unique: true });

const OtpSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true },
  otp: { type: String, required: true },
  purpose: { type: String, enum: ['register', 'forgot_password'], required: true },
  verified: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now, expires: 300 }
});

// --- MODELS ---

const User = mongoose.model('User', UserSchema);
const Student = mongoose.model('Student', StudentSchema);
const Room = mongoose.model('Room', RoomSchema);
const Exam = mongoose.model('Exam', ExamSchema);
const Seating = mongoose.model('Seating', SeatingSchema);
const Mark = mongoose.model('Mark', MarkSchema);
const Pyq = mongoose.model('Pyq', PyqSchema);
const PyqProgress = mongoose.model('PyqProgress', PyqProgressSchema);
const Mcq = mongoose.model('Mcq', McqSchema);
const McqVote = mongoose.model('McqVote', McqVoteSchema);
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
const Poll = mongoose.model('Poll', PollSchema);
const PollVote = mongoose.model('PollVote', PollVoteSchema);
const Otp = mongoose.model('Otp', OtpSchema);

async function initDB() {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected successfully.');

  const adminUser = process.env.DEFAULT_ADMIN_USER || 'shivamkumar035wp';
  const adminPass = process.env.DEFAULT_ADMIN_PASS || 'Shivam012@meow';

  const hashedPw = await bcrypt.hash(adminPass, 10);
  const adminExists = await User.findOne({ username: adminUser });

  if (!adminExists) {
    await User.create({ 
      username: adminUser, 
      password: hashedPw, 
      role: 'admin', 
      email: adminUser 
    });
    console.log(`Default Admin Account Created (Username: ${adminUser})`);
  } else {
    await User.updateOne({ username: adminUser }, { password: hashedPw, role: 'admin' });
    console.log(`Default Admin Ready: ${adminUser}`);
  }
}

module.exports = {
  initDB,
  User,
  Student,
  Room,
  Exam,
  Seating,
  Mark,
  Pyq,
  PyqProgress,
  Mcq,
  McqVote,
  ChatMessage,
  Poll,
  PollVote,
  Otp
};