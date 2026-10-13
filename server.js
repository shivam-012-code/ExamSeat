require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit-table');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { 
  initDB, User, Student, Room, Exam, Seating, Mark, Pyq, PyqProgress,
  ChatMessage, Poll, PollVote, Otp 
} = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// --- EMAIL TRANSPORTER CONFIGURATION ---
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'hello32387@gmail.com';
const SENDER_APP_PASSWORD = process.env.SENDER_APP_PASSWORD || 'smqpkprvkqkkmreg';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: SENDER_EMAIL,
    pass: SENDER_APP_PASSWORD
  }
});

// Real-time Email OTP sender function
async function sendEmailOtp(recipientEmail, otpCode, purpose) {
  const subject = purpose === 'register' 
    ? 'ExamSeat Portal - Email Verification OTP' 
    : 'ExamSeat Portal - Password Reset OTP';

  const mailOptions = {
    from: `"ExamSeat Portal" <${SENDER_EMAIL}>`,
    to: recipientEmail,
    subject: subject,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f9; border-radius: 8px;">
        <h2 style="color: #1e3a8a;">ExamSeat Portal</h2>
        <p>Aapka verification code niche diya gaya hai:</p>
        <div style="background-color: #ffffff; padding: 15px; border-left: 4px solid #2563eb; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1e293b; width: fit-content;">
          ${otpCode}
        </div>
        <p style="font-size: 13px; color: #64748b; margin-top: 15px;">Yeh OTP agle 5 minute tak valid rahega. Ise kisi ke sath share na karein.</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.response);
    return info;
  } catch (error) {
    console.error('Detailed Email Send Error:', error);
    throw error;
  }

  return transporter.sendMail(mailOptions);
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const uploadDisk = multer({ storage: storage });
const uploadMemory = multer({ storage: multer.memoryStorage() });

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'examseat_secure_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).send('Access Denied: Admin privileges required.');
}

// ---------------- EMAIL AUTH & OTP ROUTES ----------------

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, success: null });
});

app.post('/api/otp/send-register', async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email) {
    return res.status(400).json({ success: false, message: 'Registration Number and Email, both are important.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const existingUser = await User.findOne({ username: username.trim() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Already Registered' });
    }

    const existingEmail = await User.findOne({ email: cleanEmail });
    if (existingEmail) {
      return res.status(400).json({ success: false, message: 'this Email ID is already Resistered to an account' });
    }

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.deleteMany({ email: cleanEmail, purpose: 'register' });
    await Otp.create({
      email: cleanEmail,
      otp: generatedOtp,
      purpose: 'register',
      verified: false
    });

    await sendEmailOtp(cleanEmail, generatedOtp, 'register');
    res.json({ success: true, message: `OTP is successfully send to your email (${cleanEmail}). Kindly check Inbox/Spam.` });
  } catch (err) {
    console.error('Send Register Email OTP Error:', err);
    res.status(500).json({ success: false, message: 'Email bhejne me error aayi. Kripya check karein ki Gmail App Password sahi hai.' });
  }
});

app.post('/api/otp/verify-register', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Enter Email aur OTP both.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const otpRecord = await Otp.findOne({ email: cleanEmail, otp: otp.trim(), purpose: 'register' });
    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    otpRecord.verified = true;
    await otpRecord.save();

    res.json({ success: true, message: 'Email is verified successfully! Now create password.' });
  } catch (err) {
    console.error('Verify Register OTP Error:', err);
    res.status(500).json({ success: false, message: 'Verification Error.' });
  }
});

app.post('/register', async (req, res) => {
  const { username, password, email } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();

  try {
    const otpRecord = await Otp.findOne({ email: cleanEmail, purpose: 'register', verified: true });
    if (!otpRecord) {
      return res.render('login', { error: 'Registration failed: Please enter correct Email.', success: null });
    }

    const existing = await User.findOne({ username: username.trim() });
    if (existing) {
      return res.render('login', { error: 'Registration failed: Username already exist!', success: null });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({
      username: username.trim(),
      password: hashedPassword,
      email: cleanEmail,
      role: 'student'
    });

    await Otp.deleteMany({ email: cleanEmail });
    res.render('login', { error: null, success: 'Account created successfully! Please Sign In karein.' });
  } catch (err) {
    console.error('Registration Error:', err);
    res.render('login', { error: 'Registration failed.', success: null });
  }
});

app.post('/api/otp/send-forgot', async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email) {
    return res.status(400).json({ success: false, message: 'Registration Number aur Email both are important.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const user = await User.findOne({ username: username.trim(), email: cleanEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Registration Number or Email does not match from the database.' });
    }

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.deleteMany({ email: cleanEmail, purpose: 'forgot_password' });
    await Otp.create({
      email: cleanEmail,
      otp: generatedOtp,
      purpose: 'forgot_password',
      verified: false
    });

    await sendEmailOtp(cleanEmail, generatedOtp, 'forgot_password');
    res.json({ success: true, message: `OTP is send to your registered email (${cleanEmail}).` });
  } catch (err) {
    console.error('Send Forgot Email OTP Error:', err);
    res.status(500).json({ success: false, message: 'Issues come in sending Email.' });
  }
});

app.post('/api/otp/verify-forgot', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Enter Email ID and OTP both.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const otpRecord = await Otp.findOne({ email: cleanEmail, otp: otp.trim(), purpose: 'forgot_password' });
    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Wrong or expired OTP.' });
    }

    otpRecord.verified = true;
    await otpRecord.save();

    res.json({ success: true, message: 'OTP verifyed successfully! Create new password.' });
  } catch (err) {
    console.error('Verify Forgot OTP Error:', err);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { username, email, new_password } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!username || !cleanEmail || !new_password) {
    return res.status(400).json({ success: false, message: 'Please enter all the fields.' });
  }

  try {
    const otpRecord = await Otp.findOne({ email: cleanEmail, purpose: 'forgot_password', verified: true });
    if (!otpRecord) {
      return res.status(403).json({ success: false, message: 'First verify the otp' });
    }

    const newHashedPassword = await bcrypt.hash(new_password, 10);
    const updated = await User.findOneAndUpdate(
      { username: username.trim(), email: cleanEmail },
      { password: newHashedPassword }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'No user record found' });
    }

    await Otp.deleteMany({ email: cleanEmail });
    res.json({ success: true, message: 'Password changed successfully! Login with new password.' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ success: false, message: 'Error in updating Password.' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username: username.trim() });
    if (!user) {
      return res.render('login', { error: 'Invalid credentials.', success: null });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Invalid credentials.', success: null });
    }

    req.session.user = { id: user._id.toString(), username: user.username, role: user.role };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Login error occurred.', success: null });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------------- MAIN DASHBOARD ----------------

app.get('/', isAuthenticated, async (req, res) => {
  const user = req.session.user;

  const selectedBranch = req.query.branch || '';
  const selectedSemester = req.query.semester || '';
  const studentSearch = req.query.student_search ? req.query.student_search.trim() : '';
  const userSearch = req.query.user_search ? req.query.user_search.trim() : '';
  const activeTab = req.query.active_tab || '';

  try {
    if (user.role === 'admin') {
      const studentFilter = {};
      if (selectedBranch) studentFilter.branch = selectedBranch;
      if (selectedSemester) studentFilter.semester = parseInt(selectedSemester, 10);

      if (studentSearch) {
        studentFilter.$or = [
          { name: { $regex: studentSearch, $options: 'i' } },
          { reg_no: { $regex: studentSearch, $options: 'i' } }
        ];
      }

      const sortQuery = (selectedBranch || selectedSemester) ? { reg_no: 1 } : { _id: -1 };
      const studentsRaw = await Student.find(studentFilter).sort(sortQuery);

      const students = studentsRaw.map(s => ({
        id: s._id.toString(),
        reg_no: s.reg_no,
        name: s.name,
        branch: s.branch,
        semester: s.semester
      }));

      const roomsRaw = await Room.find().sort({ room_no: 1 });
      const rooms = roomsRaw.map(r => ({
        id: r._id.toString(),
        room_no: r.room_no,
        rows: r.rows || (r.column_rows && r.column_rows.length ? Math.max(...r.column_rows) : 0),
        columns: r.columns,
        column_rows: r.column_rows || [],
        active_seats: r.active_seats || [],
        seat_colors: r.seat_colors || [],
        capacity: r.capacity
      }));

      const examsRaw = await Exam.find().populate('room_id').sort({ _id: -1 });
      const exams = examsRaw.map(e => ({
        id: e._id.toString(),
        subject: e.subject,
        branch: e.branch,
        semester: e.semester,
        room_id: e.room_id ? e.room_id._id.toString() : null,
        room_no: e.room_id ? e.room_id.room_no : null,
        seat_color: e.seat_color || 'color1',
        start_reg_no: e.start_reg_no || '',
        stop_reg_no: e.stop_reg_no || '',
        exam_date: e.exam_date,
        start_time: e.start_time,
        end_time: e.end_time,
        question_paper: e.question_paper || ''
      }));

      const adminUsersRaw = await User.find({ role: 'admin' }).sort({ _id: -1 });
      const adminUsers = adminUsersRaw.map(u => ({
        id: u._id.toString(),
        username: u.username,
        role: u.role,
        created_at: u.created_at
      }));

      let searchedUsers = [];
      if (userSearch) {
        const uRows = await User.find({ username: { $regex: userSearch, $options: 'i' } }).sort({ _id: -1 });
        searchedUsers = uRows.map(u => ({
          id: u._id.toString(),
          username: u.username,
          role: u.role,
          created_at: u.created_at
        }));
      }

      const pyqsRaw = await Pyq.find().sort({ _id: -1 });
      const pyqs = pyqsRaw.map(p => ({
        id: p._id.toString(),
        title: p.title,
        branch: p.branch,
        semester: p.semester,
        subject: p.subject,
        file_url: p.file_url,
        created_at: p.created_at
      }));

      res.render('index', { 
        user, 
        students, 
        rooms, 
        exams, 
        adminUsers,
        searchedUsers,
        pyqs,
        studentPyqs: [],
        studentSubjects: [],
        userSearchQuery: userSearch,
        studentSearchQuery: studentSearch,
        selectedBranch, 
        selectedSemester, 
        activeTab,
        studentInfo: null, 
        studentSeating: [],
        studentExamsWithMarks: []
      });
    } else {
      const studentDoc = await Student.findOne({ reg_no: user.username });
      const studentInfo = studentDoc ? {
        id: studentDoc._id.toString(),
        reg_no: studentDoc.reg_no,
        name: studentDoc.name,
        branch: studentDoc.branch,
        semester: studentDoc.semester
      } : null;

      let studentSeating = [];
      let studentExamsWithMarks = [];
      let studentPyqs = [];
      let studentSubjects = [];

      if (studentDoc) {
        const seatingDocs = await Seating.find({ student_id: studentDoc._id })
          .populate('exam_id')
          .populate('room_id');

        studentSeating = seatingDocs.map(s => ({
          subject: s.exam_id ? s.exam_id.subject : 'N/A',
          exam_date: s.exam_id ? s.exam_id.exam_date : null,
          start_time: s.exam_id ? s.exam_id.start_time : '',
          end_time: s.exam_id ? s.exam_id.end_time : '',
          room_no: s.room_id ? s.room_id.room_no : 'N/A',
          row_no: s.row_no,
          column_no: s.column_no,
          seat_no: s.seat_no
        })).sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date));

        const filter = {};
        if (studentDoc.branch) filter.$or = [{ branch: studentDoc.branch }, { branch: null }, { branch: '' }];
        if (studentDoc.semester) filter.semester = studentDoc.semester;

        const examsList = await Exam.find(filter).sort({ exam_date: -1 });

        for (const exam of examsList) {
          const markDoc = await Mark.findOne({ student_id: studentDoc._id, exam_id: exam._id });
          let qWise = {};
          if (markDoc && markDoc.question_wise_marks) {
            qWise = markDoc.question_wise_marks instanceof Map
              ? Object.fromEntries(markDoc.question_wise_marks)
              : markDoc.question_wise_marks;
          }

          studentExamsWithMarks.push({
            subject: exam.subject,
            exam_date: exam.exam_date ? new Date(exam.exam_date).toISOString().split('T')[0] : 'N/A',
            start_time: exam.start_time,
            end_time: exam.end_time,
            question_paper: exam.question_paper || '',
            marks: markDoc ? markDoc.marks_obtained : null,
            total_marks: markDoc ? markDoc.total_marks : 20,
            question_wise_marks: qWise
          });
        }

        const pyqFilter = {};
        if (studentDoc.branch) pyqFilter.branch = studentDoc.branch;
        if (studentDoc.semester) pyqFilter.semester = studentDoc.semester;

        const pyqsForStudent = await Pyq.find(pyqFilter).sort({ _id: -1 });
        const progressDocs = await PyqProgress.find({
          student_id: studentDoc._id,
          is_completed: true
        });
        const completedPyqIds = progressDocs.map(p => p.pyq_id.toString());

        const subjectSet = new Set();
        studentPyqs = pyqsForStudent.map(p => {
          if (p.subject) subjectSet.add(p.subject.trim());
          return {
            id: p._id.toString(),
            title: p.title,
            branch: p.branch,
            semester: p.semester,
            subject: p.subject,
            file_url: p.file_url,
            created_at: p.created_at,
            is_completed: completedPyqIds.includes(p._id.toString())
          };
        });
        studentSubjects = Array.from(subjectSet);
      }

      res.render('index', { 
        user, 
        students: [], 
        rooms: [], 
        exams: [], 
        adminUsers: [],
        searchedUsers: [], 
        pyqs: [],
        studentPyqs,
        studentSubjects,
        userSearchQuery: '',
        studentSearchQuery: '',
        selectedBranch: '', 
        selectedSemester: '', 
        activeTab,
        studentInfo, 
        studentSeating,
        studentExamsWithMarks
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Database Error');
  }
});

// ---------------- CHAT & POLL ROUTES ----------------

app.get('/api/chat/:branch/:semester', isAuthenticated, async (req, res) => {
  const { branch } = req.params;
  const semester = parseInt(req.params.semester, 10);
  const currentUser = req.session.user;

  try {
    const messages = await ChatMessage.find({ branch, semester }).sort({ created_at: 1 }).limit(100);
    const polls = await Poll.find({ branch, semester }).sort({ created_at: -1 });

    let studentDoc = null;
    if (currentUser.role === 'student') {
      studentDoc = await Student.findOne({ reg_no: currentUser.username });
    }

    const enhancedPolls = await Promise.all(polls.map(async (p) => {
      const votes = await PollVote.find({ poll_id: p._id });
      const totalVoters = votes.length;

      const optionVoteCounts = {};
      p.options.forEach(opt => { optionVoteCounts[opt.option_id] = 0; });

      votes.forEach(v => {
        v.selected_options.forEach(optId => {
          if (optionVoteCounts[optId] !== undefined) {
            optionVoteCounts[optId]++;
          }
        });
      });

      let hasVoted = false;
      let userVotes = [];

      if (studentDoc) {
        const myVote = votes.find(v => v.student_id.toString() === studentDoc._id.toString());
        if (myVote) {
          hasVoted = true;
          userVotes = myVote.selected_options;
        }
      }

      return {
        id: p._id.toString(),
        question: p.question,
        is_multiple: p.is_multiple,
        created_by: p.created_by,
        created_at: p.created_at,
        options: p.options.map(o => ({
          option_id: o.option_id,
          text: o.text,
          votes_count: optionVoteCounts[o.option_id] || 0
        })),
        total_voters: totalVoters,
        has_voted: hasVoted,
        user_votes: userVotes
      };
    }));

    res.json({ success: true, messages, polls: enhancedPolls });
  } catch (err) {
    console.error('Fetch Chat Error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching chat data' });
  }
});

app.post('/api/chat/send', isAuthenticated, async (req, res) => {
  const { branch, semester, message } = req.body;
  const user = req.session.user;

  try {
    let senderName = user.username;
    if (user.role === 'student') {
      const s = await Student.findOne({ reg_no: user.username });
      if (s) {
        senderName = `${s.name} (${s.reg_no})`;
      }
    } else {
      senderName = 'Admin (' + user.username.split('@')[0] + ')';
    }

    const newMsg = await ChatMessage.create({
      branch: branch.trim(),
      semester: parseInt(semester, 10),
      sender_username: user.username,
      sender_name: senderName,
      sender_role: user.role,
      message: message.trim()
    });

    res.json({ success: true, message: newMsg });
  } catch (err) {
    console.error('Send Message Error:', err);
    res.status(500).json({ success: false, message: 'Could not send message' });
  }
});

app.post('/api/poll/create', isAuthenticated, isAdmin, async (req, res) => {
  const { branch, semester, question, options, is_multiple } = req.body;

  try {
    const optArray = (Array.isArray(options) ? options : [options])
      .map((t, idx) => ({ option_id: idx + 1, text: String(t).trim() }))
      .filter(o => o.text.length > 0);

    if (optArray.length < 2) {
      return res.status(400).json({ success: false, message: 'Enter minimum 2 options.' });
    }

    const poll = await Poll.create({
      branch: branch.trim(),
      semester: parseInt(semester, 10),
      question: question.trim(),
      options: optArray,
      is_multiple: Boolean(is_multiple),
      created_by: 'Admin'
    });

    res.json({ success: true, poll });
  } catch (err) {
    console.error('Create Poll Error:', err);
    res.status(500).json({ success: false, message: 'Error in Poll creation.' });
  }
});

app.post('/api/poll/vote', isAuthenticated, async (req, res) => {
  const { poll_id, selected_options } = req.body;
  const user = req.session.user;

  try {
    const student = await Student.findOne({ reg_no: user.username });
    if (!student) {
      return res.status(403).json({ success: false, message: 'Only registered students can vote.' });
    }

    const poll = await Poll.findById(poll_id);
    if (!poll) {
      return res.status(404).json({ success: false, message: 'Poll has been expired.' });
    }

    const existingVote = await PollVote.findOne({ poll_id: poll._id, student_id: student._id });
    if (existingVote) {
      return res.status(400).json({ success: false, message: 'You has already voted! You cannot change the option.' });
    }

    let opts = Array.isArray(selected_options) ? selected_options.map(Number) : [Number(selected_options)];

    await PollVote.create({
      poll_id: poll._id,
      student_id: student._id,
      reg_no: student.reg_no,
      student_name: student.name,
      selected_options: opts
    });

    res.json({ success: true, message: 'Vote recorded successfully!' });
  } catch (err) {
    console.error('Vote Error:', err);
    res.status(500).json({ success: false, message: 'Error in Vote submition.' });
  }
});

app.get('/api/poll/voters/:poll_id', isAuthenticated, isAdmin, async (req, res) => {
  const { poll_id } = req.params;

  try {
    const poll = await Poll.findById(poll_id);
    if (!poll) return res.status(404).json({ success: false, message: 'Poll has been expired.' });

    const votes = await PollVote.find({ poll_id: poll._id }).sort({ voted_at: -1 });

    const optionMap = {};
    poll.options.forEach(o => { optionMap[o.option_id] = o.text; });

    const voterDetails = votes.map(v => ({
      reg_no: v.reg_no,
      name: v.student_name,
      chosen_options: v.selected_options.map(id => optionMap[id] || `Option ${id}`),
      voted_at: v.voted_at
    }));

    res.json({ 
      success: true, 
      question: poll.question, 
      is_multiple: poll.is_multiple,
      voters: voterDetails 
    });
  } catch (err) {
    console.error('Inspect Voters Error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving voters.' });
  }
});

// ---------------- PYQs & QUESTIONS ROUTES ----------------

app.post('/upload_pyq', isAuthenticated, isAdmin, uploadDisk.single('pyq_file'), async (req, res) => {
  const { title, branch, semester, subject } = req.body;
  try {
    if (req.file) {
      const fileUrl = '/uploads/' + req.file.filename;
      await Pyq.create({
        title: title ? title.trim() : 'Question Paper',
        branch: branch ? branch.trim() : '',
        semester: semester ? parseInt(semester, 10) : null,
        subject: subject ? subject.trim() : '',
        file_url: fileUrl
      });
    }
  } catch (err) {
    console.error('Upload PYQ Error:', err);
  }
  res.redirect('/?active_tab=pyqs');
});

app.post('/delete_pyq/:id', isAuthenticated, isAdmin, async (req, res) => {
  const pyqId = req.params.id;
  try {
    await Pyq.findByIdAndDelete(pyqId);
    await PyqProgress.deleteMany({ pyq_id: pyqId });
  } catch (err) {
    console.error('Delete PYQ Error:', err);
  }
  res.redirect('/?active_tab=pyqs');
});

app.post('/toggle_pyq_status/:pyq_id', isAuthenticated, async (req, res) => {
  try {
    const studentDoc = await Student.findOne({ reg_no: req.session.user.username });
    if (!studentDoc) return res.status(404).json({ success: false, message: 'Student record not found' });

    const pyqId = req.params.pyq_id;
    const existing = await PyqProgress.findOne({ student_id: studentDoc._id, pyq_id: pyqId });

    let isCompleted = true;
    if (existing) {
      isCompleted = !existing.is_completed;
      existing.is_completed = isCompleted;
      await existing.save();
    } else {
      await PyqProgress.create({
        student_id: studentDoc._id,
        pyq_id: pyqId,
        is_completed: true
      });
    }

    res.json({ success: true, is_completed: isCompleted });
  } catch (err) {
    console.error('Toggle PYQ Progress Error:', err);
    res.status(500).json({ success: false, message: 'Server error updating progress' });
  }
});

// ---------------- QUESTION PAPER & MARKS UPLOAD ROUTES ----------------

app.post('/upload_paper/:exam_id', isAuthenticated, isAdmin, uploadDisk.single('paper_file'), async (req, res) => {
  const examId = req.params.exam_id;
  try {
    if (req.file) {
      const paperUrl = '/uploads/' + req.file.filename;
      await Exam.findByIdAndUpdate(examId, { question_paper: paperUrl });
    }
  } catch (err) {
    console.error('Upload Paper Error:', err);
  }
  res.redirect('/?active_tab=marks');
});

app.post('/upload_marks/:exam_id', isAuthenticated, isAdmin, uploadMemory.single('marks_excel'), async (req, res) => {
  const examId = req.params.exam_id;
  try {
    if (req.file) {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      for (const row of rows) {
        const reg_no = String(
          row['Reg No'] || row.reg_no || row.RegNo || row['Reg Number'] || row['reg_number'] || ''
        ).trim();

        if (!reg_no) continue;

        const questionKeys = Object.keys(row).filter(key => /^q\d+$/i.test(key.trim()));
        questionKeys.sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, ''), 10);
          const numB = parseInt(b.replace(/\D/g, ''), 10);
          return numA - numB;
        });

        const questionMarks = {};
        let totalCalculatedMarks = 0;

        questionKeys.forEach(qKey => {
          const score = parseFloat(row[qKey]) || 0;
          const cleanKey = qKey.trim().toUpperCase();
          questionMarks[cleanKey] = score;
          totalCalculatedMarks += score;
        });

        const marksObtained = (row.marks !== undefined && row.marks !== '')
          ? parseFloat(row.marks)
          : (row.marks_obtained !== undefined ? parseFloat(row.marks_obtained) : totalCalculatedMarks);

        const totalMarks = parseFloat(row['Total Marks'] || row.total_marks || row.TotalMarks || 20);

        const student = await Student.findOne({ reg_no });
        if (student) {
          await Mark.findOneAndUpdate(
            { student_id: student._id, exam_id: examId },
            { 
              marks_obtained: marksObtained, 
              total_marks: totalMarks,
              question_wise_marks: questionMarks
            },
            { upsert: true, new: true }
          );
        }
      }
    }
  } catch (err) {
    console.error('Upload Marks Error:', err);
  }
  res.redirect('/?active_tab=marks');
});

app.get('/download_sample_marks_excel/:exam_id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const seatingDocs = await Seating.find({ exam_id: examId }).populate('student_id').populate('room_id');
    seatingDocs.sort((a, b) => {
      const roomA = a.room_id ? a.room_id.room_no : '';
      const roomB = b.room_id ? b.room_id.room_no : '';
      if (roomA !== roomB) return roomA.localeCompare(roomB);
      if (a.column_no !== b.column_no) return a.column_no - b.column_no;
      return a.row_no - b.row_no;
    });

    let data = [];

    if (seatingDocs.length > 0) {
      data = seatingDocs.map(s => {
        const row = {
          'Reg No': s.student_id ? s.student_id.reg_no : '',
          'Student Name': s.student_id ? s.student_id.name : '',
          'Branch': s.student_id ? s.student_id.branch : '',
          'Semester': s.student_id && s.student_id.semester ? `Semester ${s.student_id.semester}` : '',
          'Room No': s.room_id ? s.room_id.room_no : '',
          'Column': s.column_no,
          'Row (Bench)': s.row_no,
          'Seat No': s.seat_no,
          'Total Marks': 20
        };
        for (let q = 1; q <= 9; q++) {
          row[`Q${q}`] = '';
        }
        return row;
      });
    } else {
      const sampleRow = {
        'Reg No': '1210001',
        'Student Name': 'Rahul Kumar',
        'Branch': 'CSE',
        'Semester': 'Semester 4',
        'Room No': '101',
        'Column': 1,
        'Row (Bench)': 1,
        'Seat No': '101-C1-R1-S1',
        'Total Marks': 20
      };
      for (let q = 1; q <= 9; q++) {
        sampleRow[`Q${q}`] = '';
      }
      data.push(sampleRow);
    }

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Marks Sheet');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=sample_marks_exam_${examId}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('Download Sample Excel Error:', err);
    res.status(500).send('Error generating sample Excel file');
  }
});

app.get('/get_exam_marks/:exam_id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const marksDocs = await Mark.find({ exam_id: examId }).populate('student_id');
    const marksList = marksDocs.map(m => {
      let qWise = {};
      if (m.question_wise_marks) {
        qWise = m.question_wise_marks instanceof Map
          ? Object.fromEntries(m.question_wise_marks)
          : m.question_wise_marks;
      }
      return {
        reg_no: m.student_id ? m.student_id.reg_no : 'N/A',
        name: m.student_id ? m.student_id.name : 'N/A',
        branch: m.student_id ? m.student_id.branch : 'N/A',
        semester: m.student_id ? m.student_id.semester : 'N/A',
        marks_obtained: m.marks_obtained,
        total_marks: m.total_marks,
        question_wise_marks: qWise
      };
    });
    res.json({ success: true, marks: marksList });
  } catch (err) {
    console.error('Fetch Marks Error:', err);
    res.status(500).json({ success: false, message: 'Database error fetching marks' });
  }
});

// ---------------- ADMIN DELEGATION ----------------

app.post('/make_admin/:id', isAuthenticated, isAdmin, async (req, res) => {
  const userId = req.params.id;
  const userSearch = req.body.user_search || '';
  try {
    await User.findByIdAndUpdate(userId, { role: 'admin' });
  } catch (err) { console.error(err); }
  res.redirect(`/?active_tab=admin_users&user_search=${encodeURIComponent(userSearch)}`);
});

app.post('/delete_admin/:id', isAuthenticated, isAdmin, async (req, res) => {
  const adminId = req.params.id;
  const userSearch = req.body.user_search || '';

  try {
    if (adminId !== req.session.user.id) {
      await User.findOneAndDelete({ _id: adminId, role: 'admin' });
    }
  } catch (err) { console.error(err); }
  res.redirect(`/?active_tab=admin_users&user_search=${encodeURIComponent(userSearch)}`);
});

// ---------------- STUDENT MANAGEMENT ----------------

app.post('/add_student', isAuthenticated, isAdmin, async (req, res) => {
  const { reg_no, name, branch, semester } = req.body;
  const cleanRegNo = reg_no.trim();

  try {
    const existing = await Student.findOne({ reg_no: cleanRegNo });
    if (!existing) {
      await Student.create({
        reg_no: cleanRegNo,
        name: name.trim(),
        branch: branch || null,
        semester: semester ? parseInt(semester, 10) : null
      });
    }
  } catch (err) { console.error(err); }

  if (branch && semester) {
    res.redirect(`/?branch=${encodeURIComponent(branch)}&semester=${encodeURIComponent(semester)}`);
  } else {
    res.redirect('/');
  }
});

app.post('/upload_students', isAuthenticated, isAdmin, uploadMemory.single('excel_file'), async (req, res) => {
  if (!req.file) return res.redirect('/');

  const chosenBranch = req.body.branch;
  const chosenSemester = req.body.semester;

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    let rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    rows = shuffleArray(rows);

    for (const row of rows) {
      const reg_no = String(row.reg_no || row.RegNo || row['Reg Number'] || row['reg_number'] || '').trim();
      const name = String(row.name || row.Name || row['Student Name'] || row['student_name'] || '').trim();
      const branch = chosenBranch || String(row.branch || row.Branch || '').trim();
      const semester = chosenSemester || row.semester || row.Semester || null;

      if (reg_no && name) {
        await Student.findOneAndUpdate(
          { reg_no: reg_no },
          { name, branch: branch || null, semester: semester ? parseInt(semester, 10) : null },
          { upsert: true, new: true }
        );
      }
    }
  } catch (err) { console.error(err); }

  if (chosenBranch && chosenSemester) {
    res.redirect(`/?branch=${encodeURIComponent(chosenBranch)}&semester=${encodeURIComponent(chosenSemester)}`);
  } else {
    res.redirect('/');
  }
});

app.post('/delete_student/:id', isAuthenticated, isAdmin, async (req, res) => {
  const studentId = req.params.id;
  const { branch, semester } = req.body;

  try {
    await Student.findByIdAndDelete(studentId);
    await Seating.deleteMany({ student_id: studentId });
    await Mark.deleteMany({ student_id: studentId });
  } catch (err) { console.error(err); }

  if (branch && semester) {
    res.redirect(`/?branch=${encodeURIComponent(branch)}&semester=${encodeURIComponent(semester)}`);
  } else {
    res.redirect('/');
  }
});

// ---------------- ROOM MANAGEMENT ----------------

app.post('/add_room', isAuthenticated, isAdmin, async (req, res) => {
  const { room_no, columns, column_rows, rows } = req.body;
  const numCols = parseInt(columns, 10);
  
  let colRowsArray = [];
  if (Array.isArray(column_rows)) {
    colRowsArray = column_rows.map(r => parseInt(r, 10) || 0);
  } else if (column_rows) {
    colRowsArray = [parseInt(column_rows, 10) || 0];
  } else if (rows) {
    const fixedRows = parseInt(rows, 10) || 0;
    colRowsArray = Array(numCols).fill(fixedRows);
  }

  const totalBenches = colRowsArray.reduce((sum, count) => sum + count, 0);
  const totalCapacity = totalBenches * 2;
  const maxRows = colRowsArray.length ? Math.max(...colRowsArray) : 0;

  try {
    await Room.create({
      room_no: room_no.trim(),
      rows: maxRows,
      columns: numCols,
      column_rows: colRowsArray,
      capacity: totalCapacity
    });
  } catch (err) { console.error(err); }
  res.redirect('/?active_tab=rooms');
});

app.post('/update_room_seats/:id', isAuthenticated, isAdmin, async (req, res) => {
  const roomId = req.params.id;
  const { active_seats, seat_colors_json } = req.body;

  let seatsArray = Array.isArray(active_seats) ? active_seats : (active_seats ? [active_seats] : []);
  let seatColorsArray = [];
  if (seat_colors_json) {
    try { seatColorsArray = JSON.parse(seat_colors_json); } catch (e) { console.error(e); }
  }

  try {
    await Room.findByIdAndUpdate(roomId, { active_seats: seatsArray, seat_colors: seatColorsArray });
  } catch (err) { console.error(err); }
  res.redirect('/?active_tab=rooms');
});

app.post('/delete_room/:id', isAuthenticated, isAdmin, async (req, res) => {
  const roomId = req.params.id;

  try {
    await Room.findByIdAndDelete(roomId);
    await Exam.updateMany({ room_id: roomId }, { $set: { room_id: null } });
    await Seating.deleteMany({ room_id: roomId });
  } catch (err) { console.error(err); }
  res.redirect('/?active_tab=rooms');
});

// ---------------- EXAM MANAGEMENT ----------------

app.post('/add_exam', isAuthenticated, isAdmin, async (req, res) => {
  const { 
    subject, branch, semester, room_id, seat_color, start_reg_no, stop_reg_no, exam_date, start_time, end_time, 
    second_exam_enabled, subject2, branch2, semester2, seat_color2, start_reg_no2, stop_reg_no2 
  } = req.body;

  try {
    await Exam.create({
      subject: subject.trim(),
      branch: branch || null,
      semester: semester ? parseInt(semester, 10) : null,
      room_id: room_id ? room_id : null,
      seat_color: seat_color || 'color1',
      start_reg_no: start_reg_no ? start_reg_no.trim() : '',
      stop_reg_no: stop_reg_no ? stop_reg_no.trim() : '',
      exam_date: exam_date,
      start_time: start_time,
      end_time: end_time
    });

    if (second_exam_enabled === 'true' && subject2) {
      await Exam.create({
        subject: subject2.trim(),
        branch: branch2 || null,
        semester: semester2 ? parseInt(semester2, 10) : null,
        room_id: room_id ? room_id : null,
        seat_color: seat_color2 || 'color2',
        start_reg_no: start_reg_no2 ? start_reg_no2.trim() : '',
        stop_reg_no: stop_reg_no2 ? stop_reg_no2.trim() : '',
        exam_date: exam_date,
        start_time: start_time,
        end_time: end_time
      });
    }
  } catch (err) { console.error(err); }
  res.redirect('/?active_tab=exams');
});

app.post('/edit_exam/:id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.id;
  const { subject, branch, semester, room_id, seat_color, start_reg_no, stop_reg_no, exam_date, start_time, end_time } = req.body;

  try {
    await Exam.findByIdAndUpdate(examId, {
      subject: subject.trim(),
      branch: branch || null,
      semester: semester ? parseInt(semester, 10) : null,
      room_id: room_id ? room_id : null,
      seat_color: seat_color || 'color1',
      start_reg_no: start_reg_no ? start_reg_no.trim() : '',
      stop_reg_no: stop_reg_no ? stop_reg_no.trim() : '',
      exam_date: exam_date,
      start_time: start_time,
      end_time: end_time
    });
  } catch (err) { console.error(err); }
  res.redirect('/?active_tab=exams');
});

app.post('/delete_exam/:id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.id;

  try {
    await Exam.findByIdAndDelete(examId);
    await Seating.deleteMany({ exam_id: examId });
    await Mark.deleteMany({ exam_id: examId });
  } catch (err) { console.error(err); }
  res.redirect('/?active_tab=exams');
});

app.get('/generate_seating/:exam_id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.exam_id;

  try {
    const targetExam = await Exam.findById(examId);
    if (!targetExam) return res.redirect('/?active_tab=exams');

    let roomExams = targetExam.room_id ? await Exam.find({ room_id: targetExam.room_id }) : [targetExam];
    const room = await Room.findById(targetExam.room_id);
    if (!room) return res.redirect('/?active_tab=exams');

    const examIds = roomExams.map(e => e._id);
    await Seating.deleteMany({ exam_id: { $in: examIds } });

    const hasActiveSeatsConfig = room.active_seats && room.active_seats.length > 0;
    const seatColorMap = {};

    if (room.seat_colors && room.seat_colors.length > 0) {
      room.seat_colors.forEach(sc => { seatColorMap[sc.seat_key] = sc.color; });
    }

    for (let c = 1; c <= room.columns; c++) {
      const rowsInCol = (room.column_rows && room.column_rows[c - 1]) ? room.column_rows[c - 1] : (room.rows || 1);
      for (let r = 1; r <= rowsInCol; r++) {
        const keyS1 = `C${c}-R${r}-S1`;
        const keyS2 = `C${c}-R${r}-S2`;
        if (!seatColorMap[keyS1]) seatColorMap[keyS1] = 'color1';
        if (!seatColorMap[keyS2]) seatColorMap[keyS2] = 'color2';
      }
    }

    for (const exam of roomExams) {
      const studentFilter = {};
      if (exam.branch) studentFilter.branch = exam.branch;
      if (exam.semester) studentFilter.semester = exam.semester;

      let students = await Student.find(studentFilter);

      if (exam.start_reg_no && exam.stop_reg_no) {
        const startReg = exam.start_reg_no.trim();
        const stopReg = exam.stop_reg_no.trim();
        students = students.filter(s => {
          const r = s.reg_no.trim();
          return r.localeCompare(startReg, undefined, { numeric: true }) >= 0 && 
                 r.localeCompare(stopReg, undefined, { numeric: true }) <= 0;
        });
      }

      students = shuffleArray(students);
      let sIndex = 0;
      const targetSeatColor = exam.seat_color || 'color1';

      for (let c = 1; c <= room.columns; c++) {
        const rowsInThisCol = (room.column_rows && room.column_rows[c - 1]) ? room.column_rows[c - 1] : (room.rows || 1);

        for (let r = 1; r <= rowsInThisCol; r++) {
          for (let s = 1; s <= 2; s++) {
            if (sIndex >= students.length) break;

            const seatKey = `C${c}-R${r}-S${s}`;
            if (hasActiveSeatsConfig && !room.active_seats.includes(seatKey)) continue;

            const actualSeatColor = seatColorMap[seatKey] || (s === 1 ? 'color1' : 'color2');
            if (actualSeatColor !== targetSeatColor) continue;

            const student = students[sIndex];
            const seatNo = `${room.room_no}-C${c}-R${r}-S${s}`;

            await Seating.create({
              student_id: student._id,
              exam_id: exam._id,
              room_id: room._id,
              row_no: r,
              column_no: c,
              seat_no: seatNo
            });

            sIndex++;
          }
          if (sIndex >= students.length) break;
        }
        if (sIndex >= students.length) break;
      }
    }
  } catch (err) { console.error(err); }
  res.redirect('/?active_tab=exams');
});

// ---------------- EXPORTS ----------------

app.get('/export_seating_excel/:exam_id', isAuthenticated, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const seatingDocs = await Seating.find({ exam_id: examId }).populate('student_id').populate('room_id');
    seatingDocs.sort((a, b) => {
      const roomA = a.room_id ? a.room_id.room_no : '';
      const roomB = b.room_id ? b.room_id.room_no : '';
      if (roomA !== roomB) return roomA.localeCompare(roomB);
      if (a.column_no !== b.column_no) return a.column_no - b.column_no;
      return a.row_no - b.row_no;
    });

    const data = seatingDocs.map(s => ({
      'Reg No': s.student_id ? s.student_id.reg_no : 'N/A',
      'Student Name': s.student_id ? s.student_id.name : 'N/A',
      'Branch': s.student_id ? s.student_id.branch : 'N/A',
      'Semester': s.student_id && s.student_id.semester ? `Semester ${s.student_id.semester}` : 'N/A',
      'Room No': s.room_id ? s.room_id.room_no : 'N/A',
      'Column': s.column_no,
      'Row (Bench)': s.row_no,
      'Seat No': s.seat_no
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Seating Arrangement');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=seating_exam_${examId}.xlsx`);
    res.send(buffer);
  } catch (err) { res.status(500).send('Export Error'); }
});

app.get('/export_seating_pdf/:exam_id', isAuthenticated, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const seatingDocs = await Seating.find({ exam_id: examId }).populate('student_id').populate('room_id');
    seatingDocs.sort((a, b) => {
      const roomA = a.room_id ? a.room_id.room_no : '';
      const roomB = b.room_id ? b.room_id.room_no : '';
      if (roomA !== roomB) return roomA.localeCompare(roomB);
      if (a.column_no !== b.column_no) return a.column_no - b.column_no;
      return a.row_no - b.row_no;
    });

    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=seating_exam_${examId}.pdf`);

    doc.pipe(res);

    const table = {
      title: `Exam Seating Arrangement (Exam ID: ${examId})`,
      headers: ['Reg No', 'Student Name', 'Branch', 'Semester', 'Room No', 'Row', 'Col', 'Seat No'],
      rows: seatingDocs.map(s => [
        s.student_id ? s.student_id.reg_no : 'N/A',
        s.student_id ? s.student_id.name : 'N/A',
        s.student_id && s.student_id.branch ? s.student_id.branch : 'N/A',
        s.student_id && s.student_id.semester ? `Sem ${s.student_id.semester}` : 'N/A',
        s.room_id ? s.room_id.room_no : 'N/A',
        s.row_no.toString(),
        s.column_no.toString(),
        s.seat_no
      ])
    };

    await doc.table(table);
    doc.end();
  } catch (err) { res.status(500).send('PDF Generation Error'); }
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`)))
  .catch(err => console.error('DB Init Error:', err));