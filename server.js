require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit-table');
const path = require('path');
const fs = require('fs');
const {
  initDB, User, Student, Room, Exam, Seating, Mark, Pyq, PyqProgress,
  Mcq, McqVote, ChatMessage, Poll, PollVote, Otp
} = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Real-time Email OTP sender function
async function sendEmailOtp(recipientEmail, otpCode, purpose) {
  if (!recipientEmail) {
    throw new Error('Recipient email address is missing or empty.');
  }

  const subject = purpose === 'register'
    ? 'ExamSeat Portal - Email Verification Code (OTP)'
    : 'ExamSeat Portal - Password Reset Verification Code (OTP)';

  const emailData = {
    service_id: process.env.EMAILJS_SERVICE_ID,
    template_id: process.env.EMAILJS_TEMPLATE_ID,
    user_id: process.env.EMAILJS_PUBLIC_KEY,
    template_params: {
      to_email: recipientEmail,
      otp_code: otpCode,
      subject_text: subject
    }
  };

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(emailData)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('EmailJS send failed: ' + errorText);
  }

  return true;
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
    res.status(500).json({ success: false, message: 'Email send failed: ' + err.message });
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

      const mcqsRaw = await Mcq.find().sort({ _id: -1 });
      const mcqs = await Promise.all(mcqsRaw.map(async (m) => {
        const votes = await McqVote.find({ mcq_id: m._id });
        const totalVotes = votes.length;
        const optionCounts = {};
        m.options.forEach(o => { optionCounts[o.option_id] = 0; });

        votes.forEach(v => {
          v.selected_options.forEach(optId => {
            if (optionCounts[optId] !== undefined) {
              optionCounts[optId]++;
            }
          });
        });

        return {
          id: m._id.toString(),
          branch: m.branch,
          semester: m.semester,
          subject: m.subject || 'General',
          question: m.question,
          is_multiple: m.is_multiple,
          correct_options: m.correct_options,
          options: m.options.map(o => ({
            option_id: o.option_id,
            text: o.text,
            votes_count: optionCounts[o.option_id] || 0,
            percentage: totalVotes > 0 ? Math.round(((optionCounts[o.option_id] || 0) / totalVotes) * 100) : 0
          })),
          total_votes: totalVotes,
          created_at: m.created_at
        };
      }));

      res.render('index', {
        user,
        students,
        rooms,
        exams,
        adminUsers,
        searchedUsers,
        pyqs,
        mcqs,
        studentPyqs: [],
        studentMcqs: [],
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
      let studentMcqs = [];
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

        const subjectMap = new Map();

        studentPyqs = pyqsForStudent.map(p => {
          if (p.subject) {
            const cleanSub = p.subject.trim();
            const lowerKey = cleanSub.toLowerCase();
            if (!subjectMap.has(lowerKey)) {
              subjectMap.set(lowerKey, cleanSub);
            }
          }
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

        const mcqsForStudent = await Mcq.find(pyqFilter).sort({ _id: -1 });
        const myMcqVotes = await McqVote.find({ student_id: studentDoc._id });
        const voteMap = {};
        myMcqVotes.forEach(v => { voteMap[v.mcq_id.toString()] = v; });

        studentMcqs = mcqsForStudent.map(m => {
          if (m.subject) {
            const cleanSub = m.subject.trim();
            const lowerKey = cleanSub.toLowerCase();
            if (!subjectMap.has(lowerKey)) {
              subjectMap.set(lowerKey, cleanSub);
            }
          }
          const myVote = voteMap[m._id.toString()];
          return {
            id: m._id.toString(),
            branch: m.branch,
            semester: m.semester,
            subject: m.subject || 'General',
            question: m.question,
            is_multiple: m.is_multiple,
            options: m.options,
            has_submitted: !!myVote,
            selected_options: myVote ? myVote.selected_options : [],
            is_correct: myVote ? myVote.is_correct : null,
            correct_options: myVote ? m.correct_options : []
          };
        });

        studentSubjects = Array.from(subjectMap.values());
      }

      res.render('index', {
        user,
        students: [],
        rooms: [],
        exams: [],
        adminUsers: [],
        searchedUsers: [],
        pyqs: [],
        mcqs: [],
        studentPyqs,
        studentMcqs,
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

// ---------------- PYQs & MCQ QUESTIONS ROUTES ----------------

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

// --- MCQ ROUTES ---

app.post('/api/mcq/create', isAuthenticated, isAdmin, async (req, res) => {
  const { branch, semester, subject, question, options, correct_options, is_multiple } = req.body;
  try {
    if (!branch || !semester || !question) {
      return res.status(400).json({ success: false, message: 'Branch, Semester, and Question are required.' });
    }

    const optArray = (Array.isArray(options) ? options : [])
      .map((t, idx) => ({ option_id: idx + 1, text: String(t).trim() }))
      .filter(o => o.text.length > 0);

    if (optArray.length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide at least 2 valid options.' });
    }

    const corrArray = (Array.isArray(correct_options) ? correct_options : [correct_options])
      .map(Number)
      .filter(n => !isNaN(n) && optArray.some(o => o.option_id === n));

    if (corrArray.length === 0) {
      return res.status(400).json({ success: false, message: 'Please mark at least one correct option before posting.' });
    }

    await Mcq.create({
      branch: branch.trim(),
      semester: parseInt(semester, 10),
      subject: subject ? subject.trim() : 'General',
      question: question.trim(),
      options: optArray,
      correct_options: corrArray,
      is_multiple: Boolean(is_multiple)
    });

    res.json({ success: true, message: 'MCQ Question posted successfully!' });
  } catch (err) {
    console.error('Create MCQ Error:', err);
    res.status(500).json({ success: false, message: 'Error creating MCQ question.' });
  }
});

app.post('/api/mcq/edit/:id', isAuthenticated, isAdmin, async (req, res) => {
  const mcqId = req.params.id;
  const { branch, semester, subject, question, options, correct_options, is_multiple } = req.body;
  try {
    const optArray = (Array.isArray(options) ? options : [])
      .map((t, idx) => ({ option_id: idx + 1, text: String(t).trim() }))
      .filter(o => o.text.length > 0);

    if (optArray.length < 2) {
      return res.status(400).json({ success: false, message: 'Minimum 2 options are required.' });
    }

    const corrArray = (Array.isArray(correct_options) ? correct_options : [correct_options])
      .map(Number)
      .filter(n => !isNaN(n) && optArray.some(o => o.option_id === n));

    if (corrArray.length === 0) {
      return res.status(400).json({ success: false, message: 'Please mark at least one correct option.' });
    }

    const updatedMcq = await Mcq.findByIdAndUpdate(mcqId, {
      branch: branch.trim(),
      semester: parseInt(semester, 10),
      subject: subject ? subject.trim() : 'General',
      question: question.trim(),
      options: optArray,
      correct_options: corrArray,
      is_multiple: Boolean(is_multiple)
    }, { new: true });

    if (updatedMcq) {
      const existingVotes = await McqVote.find({ mcq_id: mcqId });
      const sortedCorrect = [...corrArray].sort((a, b) => a - b);
      for (const v of existingVotes) {
        const sortedSelected = [...v.selected_options].sort((a, b) => a - b);
        const isCorrectNow = sortedSelected.length === sortedCorrect.length &&
          sortedSelected.every((val, index) => val === sortedCorrect[index]);
        if (v.is_correct !== isCorrectNow) {
          v.is_correct = isCorrectNow;
          await v.save();
        }
      }
    }

    res.json({ success: true, message: 'MCQ Question updated successfully!' });
  } catch (err) {
    console.error('Edit MCQ Error:', err);
    res.status(500).json({ success: false, message: 'Error updating MCQ question.' });
  }
});

app.post('/delete_mcq/:id', isAuthenticated, isAdmin, async (req, res) => {
  const mcqId = req.params.id;
  try {
    await Mcq.findByIdAndDelete(mcqId);
    await McqVote.deleteMany({ mcq_id: mcqId });
  } catch (err) {
    console.error('Delete MCQ Error:', err);
  }
  res.redirect('/?active_tab=pyqs');
});

app.post('/api/mcq/submit', isAuthenticated, async (req, res) => {
  const { mcq_id, selected_options } = req.body;
  const user = req.session.user;

  try {
    const student = await Student.findOne({ reg_no: user.username });
    if (!student) {
      return res.status(403).json({ success: false, message: 'Only registered students can submit answers.' });
    }

    const mcq = await Mcq.findById(mcq_id);
    if (!mcq) {
      return res.status(404).json({ success: false, message: 'MCQ Question not found.' });
    }

    const existingVote = await McqVote.findOne({ mcq_id: mcq._id, student_id: student._id });
    if (existingVote) {
      return res.status(400).json({ success: false, message: 'You have already submitted your answer! You cannot change it.' });
    }

    let opts = Array.isArray(selected_options) ? selected_options.map(Number) : [Number(selected_options)];
    opts = opts.filter(n => !isNaN(n));

    if (opts.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select an option before submitting.' });
    }

    const sortedSelected = [...opts].sort((a, b) => a - b);
    const sortedCorrect = [...mcq.correct_options].sort((a, b) => a - b);

    const isCorrect = sortedSelected.length === sortedCorrect.length &&
      sortedSelected.every((val, index) => val === sortedCorrect[index]);

    await McqVote.create({
      mcq_id: mcq._id,
      student_id: student._id,
      reg_no: student.reg_no,
      student_name: student.name,
      selected_options: opts,
      is_correct: isCorrect
    });

    res.json({
      success: true,
      is_correct: isCorrect,
      correct_options: mcq.correct_options,
      selected_options: opts,
      feedback_msg: isCorrect
        ? '🎉 Congratulations! Your answer is correct.'
        : '❌ wrong answer, please study well and focus on this topic'
    });
  } catch (err) {
    console.error('Submit MCQ Error:', err);
    res.status(500).json({ success: false, message: 'Error submitting answer.' });
  }
});

app.get('/api/mcq/voters/:mcq_id', isAuthenticated, isAdmin, async (req, res) => {
  const { mcq_id } = req.params;
  try {
    const mcq = await Mcq.findById(mcq_id);
    if (!mcq) return res.status(404).json({ success: false, message: 'MCQ not found.' });

    const votes = await McqVote.find({ mcq_id: mcq._id }).sort({ submitted_at: -1 });
    const totalVotes = votes.length;

    const optionMap = {};
    const optionCounts = {};
    mcq.options.forEach(o => {
      optionMap[o.option_id] = o.text;
      optionCounts[o.option_id] = 0;
    });

    votes.forEach(v => {
      v.selected_options.forEach(optId => {
        if (optionCounts[optId] !== undefined) optionCounts[optId]++;
      });
    });

    const optionStats = mcq.options.map(o => ({
      option_id: o.option_id,
      text: o.text,
      is_correct: mcq.correct_options.includes(o.option_id),
      count: optionCounts[o.option_id] || 0,
      percentage: totalVotes > 0 ? Math.round(((optionCounts[o.option_id] || 0) / totalVotes) * 100) : 0
    }));

    const voterDetails = votes.map(v => ({
      reg_no: v.reg_no,
      name: v.student_name,
      chosen_options: v.selected_options.map(id => optionMap[id] || `Option ${id}`),
      is_correct: v.is_correct,
      submitted_at: v.submitted_at
    }));

    res.json({
      success: true,
      question: mcq.question,
      is_multiple: mcq.is_multiple,
      total_votes: totalVotes,
      option_stats: optionStats,
      voters: voterDetails
    });
  } catch (err) {
    console.error('Inspect MCQ Voters Error:', err);
    res.status(500).json({ success: false, message: 'Error retrieving MCQ voters.' });
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

// ---------------- EXAM SEAT LAYOUT PREVIEW & GRAPHICAL PDF ROUTES ----------------

app.get('/api/exam_seat_layout/:exam_id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const exam = await Exam.findById(examId).populate('room_id');
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
    if (!exam.room_id) return res.status(400).json({ success: false, message: 'No room assigned to this exam.' });

    const room = exam.room_id;

    // Fetch all seating records for this room so admin sees the complete room layout
    const roomExams = await Exam.find({ room_id: room._id });
    const roomExamIds = roomExams.map(e => e._id);
    const examMap = {};
    roomExams.forEach(e => {
      examMap[e._id.toString()] = {
        subject: e.subject,
        branch: e.branch,
        semester: e.semester,
        seat_color: e.seat_color || 'color1'
      };
    });

    const seatingDocs = await Seating.find({ exam_id: { $in: roomExamIds } }).populate('student_id');
    const assignedMap = {};

    seatingDocs.forEach(s => {
      const prefix = `${room.room_no}-`;
      const seatKey = s.seat_no.startsWith(prefix) ? s.seat_no.slice(prefix.length) : `C${s.column_no}-R${s.row_no}-S1`;
      if (s.student_id) {
        const exInfo = examMap[s.exam_id.toString()] || {};
        assignedMap[seatKey] = {
          reg_no: s.student_id.reg_no,
          last3: s.student_id.reg_no.slice(-3),
          name: s.student_id.name,
          branch: s.student_id.branch || exInfo.branch || '',
          semester: s.student_id.semester || exInfo.semester || '',
          subject: exInfo.subject || exam.subject,
          exam_id: s.exam_id.toString()
        };
      }
    });

    res.json({
      success: true,
      exam: {
        id: exam._id.toString(),
        subject: exam.subject,
        branch: exam.branch,
        semester: exam.semester,
        seat_color: exam.seat_color || 'color1',
        exam_date: exam.exam_date ? new Date(exam.exam_date).toISOString().split('T')[0] : '',
        start_time: exam.start_time,
        end_time: exam.end_time
      },
      room: {
        id: room._id.toString(),
        room_no: room.room_no,
        columns: room.columns,
        rows: room.rows,
        column_rows: room.column_rows || [],
        active_seats: room.active_seats || [],
        seat_colors: room.seat_colors || []
      },
      assigned_seats: assignedMap
    });
  } catch (err) {
    console.error('Exam Seat Layout Fetch Error:', err);
    res.status(500).json({ success: false, message: 'Server error loading exam seat layout.' });
  }
});

app.get('/download_seat_layout_pdf/:exam_id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const exam = await Exam.findById(examId).populate('room_id');
    if (!exam || !exam.room_id) {
      return res.status(404).send('Exam or Room not found');
    }

    const room = exam.room_id;
    const roomExams = await Exam.find({ room_id: room._id });
    const roomExamIds = roomExams.map(e => e._id);

    const seatingDocs = await Seating.find({ exam_id: { $in: roomExamIds } }).populate('student_id');
    const assignedMap = {};

    seatingDocs.forEach(s => {
      const prefix = `${room.room_no}-`;
      const seatKey = s.seat_no.startsWith(prefix) ? s.seat_no.slice(prefix.length) : `C${s.column_no}-R${s.row_no}-S1`;
      if (s.student_id) {
        assignedMap[seatKey] = {
          reg_no: s.student_id.reg_no,
          name: s.student_id.name,
          branch: s.student_id.branch || ''
        };
      }
    });

    const hasActiveSeatsConfig = room.active_seats && room.active_seats.length > 0;
    const seatColorMap = {};
    if (room.seat_colors && room.seat_colors.length > 0) {
      room.seat_colors.forEach(sc => { seatColorMap[sc.seat_key] = sc.color; });
    }

    const doc = new PDFDocument({ margin: 25, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Seat_Layout_Room_${room.room_no}_${exam.subject.replace(/\s+/g, '_')}.pdf`);
    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 25;
    const usableWidth = pageWidth - margin * 2;

    // Header Info
    const formattedDate = exam.exam_date ? new Date(exam.exam_date).toISOString().split('T')[0] : 'N/A';
    doc.fontSize(15).fillColor('#1e3a8a').font('Helvetica-Bold')
      .text(`ROOM ${room.room_no} - GRAPHICAL SEAT LAYOUT`, margin, 20, { align: 'center', width: usableWidth });

    doc.fontSize(10).fillColor('#334155').font('Helvetica')
      .text(`Exam: ${exam.subject} (${exam.branch || 'All'} - Sem ${exam.semester || 'N/A'}) | Date: ${formattedDate} | Time: ${exam.start_time} - ${exam.end_time}`, margin, 40, { align: 'center', width: usableWidth });

    // Blackboard Banner
    doc.roundedRect(margin + 120, 56, usableWidth - 240, 18, 4).fill('#1e293b');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
      .text('BLACKBOARD / TEACHER DESK (FRONT)', margin + 120, 61, { align: 'center', width: usableWidth - 240 });

    const numCols = room.columns || 1;
    const colGap = 10;
    const colWidth = (usableWidth - (numCols - 1) * colGap) / numCols;

    let maxRows = room.rows || 1;
    if (room.column_rows && room.column_rows.length > 0) {
      maxRows = Math.max(...room.column_rows);
    }

    const startY = 82;
    const colHeaderH = 20;
    const availableGridH = pageHeight - startY - margin - colHeaderH - 10;
    const rowGap = 4;
    const benchH = Math.min(34, Math.max(18, Math.floor((availableGridH - (maxRows - 1) * rowGap) / maxRows)));

    for (let c = 1; c <= numCols; c++) {
      const colX = margin + (c - 1) * (colWidth + colGap);
      const rowsInCol = (room.column_rows && room.column_rows[c - 1]) ? room.column_rows[c - 1] : (room.rows || 1);

      // Column Header Box
      doc.roundedRect(colX, startY, colWidth, colHeaderH, 3).fillAndStroke('#eef2ff', '#cbd5e1');
      doc.fillColor('#1e3a8a').fontSize(9).font('Helvetica-Bold')
        .text(`Column ${c}`, colX, startY + 5, { width: colWidth, align: 'center' });

      const labelW = 18;
      const seatGap = 3;
      const seatW = (colWidth - labelW - seatGap * 3) / 2;

      for (let r = 1; r <= rowsInCol; r++) {
        const rowY = startY + colHeaderH + 5 + (r - 1) * (benchH + rowGap);

        // Row Label (R1, R2...)
        doc.roundedRect(colX, rowY, labelW, benchH, 3).fill('#f59e0b');
        doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold')
          .text(`R${r}`, colX, rowY + (benchH / 2) - 3, { width: labelW, align: 'center' });

        for (let s = 1; s <= 2; s++) {
          const seatX = colX + labelW + seatGap + (s - 1) * (seatW + seatGap);
          const seatKey = `C${c}-R${r}-S${s}`;
          const isDisabled = hasActiveSeatsConfig && !room.active_seats.includes(seatKey);
          const seatColor = seatColorMap[seatKey] || (s === 1 ? 'color1' : 'color2');
          const assigned = assignedMap[seatKey];

          let fillBg = '#f8fafc';
          let strokeClr = '#94a3b8';
          let textClr = '#0f172a';

          if (isDisabled) {
            fillBg = '#e2e8f0';
            strokeClr = '#cbd5e1';
            textClr = '#94a3b8';
          } else if (assigned) {
            fillBg = seatColor === 'color2' ? '#fef2f2' : '#eff6ff';
            strokeClr = seatColor === 'color2' ? '#dc2626' : '#2563eb';
            textClr = seatColor === 'color2' ? '#991b1b' : '#1e3a8a';
          }

          doc.roundedRect(seatX, rowY, seatW, benchH, 3).fillAndStroke(fillBg, strokeClr);

          if (isDisabled) {
            doc.fillColor(textClr).fontSize(6.5).font('Helvetica')
              .text(`S${s}: Disabled`, seatX + 2, rowY + (benchH / 2) - 3, { width: seatW - 4, align: 'center' });
          } else if (assigned) {
            // Display FULL Registration Number inside the seat box
            const regFontSize = seatW < 65 ? 6 : 7.5;
            doc.fillColor(textClr).fontSize(regFontSize).font('Helvetica-Bold')
              .text(assigned.reg_no, seatX + 2, rowY + 3, { width: seatW - 4, align: 'center', lineBreak: false });

            if (benchH >= 24) {
              doc.fillColor('#475569').fontSize(5.5).font('Helvetica')
                .text(`S${s} (${assigned.name.slice(0, 12)})`, seatX + 2, rowY + benchH - 9, { width: seatW - 4, align: 'center', lineBreak: false });
            }
          } else {
            doc.fillColor('#64748b').fontSize(6.5).font('Helvetica')
              .text(`S${s}: Empty`, seatX + 2, rowY + (benchH / 2) - 3, { width: seatW - 4, align: 'center' });
          }
        }
      }
    }

    doc.end();
  } catch (err) {
    console.error('Download Seat Layout PDF Error:', err);
    res.status(500).send('Error generating Seat Layout PDF');
  }
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