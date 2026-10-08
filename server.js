require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit-table');
const path = require('path');
const { initDB, User, Student, Room, Exam, Seating } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

const upload = multer({ storage: multer.memoryStorage() });

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

// ---------------- AUTH ROUTES ----------------

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { error: null, success: null });
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existing = await User.findOne({ username: username.trim() });
    if (existing) {
      return res.render('login', { error: 'Registration failed: Username / Registration Number already exists!', success: null });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ username: username.trim(), password: hashedPassword, role: 'student' });
    res.render('login', { error: null, success: 'Account created successfully! Please sign in.' });
  } catch (err) {
    console.error('Registration Error:', err);
    res.render('login', { error: 'Registration failed.', success: null });
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
    console.error('Login Error:', err);
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
        columns_config: r.columns_config || [],
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
        columns_config: e.room_id ? e.room_id.columns_config : [],
        exam_date: e.exam_date,
        start_time: e.start_time,
        end_time: e.end_time
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

      res.render('index', { 
        user, 
        students, 
        rooms, 
        exams, 
        adminUsers,
        searchedUsers,
        userSearchQuery: userSearch,
        studentSearchQuery: studentSearch,
        selectedBranch, 
        selectedSemester, 
        activeTab,
        studentInfo: null, 
        studentSeating: [] 
      });
    } else {
      const cleanUsername = String(user.username || '').trim();

      const studentDoc = await Student.findOne({ 
        reg_no: { $regex: `^${cleanUsername}$`, $options: 'i' } 
      }) || await Student.findOne({ reg_no: cleanUsername });

      const studentInfo = studentDoc ? {
        id: studentDoc._id.toString(),
        reg_no: studentDoc.reg_no,
        name: studentDoc.name,
        branch: studentDoc.branch,
        semester: studentDoc.semester
      } : null;

      let studentSeating = [];
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
          column_no: s.column_no,
          row_no: s.row_no,
          seat_position: s.seat_position,
          color_tag: s.color_tag,
          seat_no: s.seat_no
        })).sort((a, b) => {
          if (!a.exam_date) return 1;
          if (!b.exam_date) return -1;
          return new Date(a.exam_date) - new Date(b.exam_date);
        });
      }

      res.render('index', { 
        user, 
        students: [], 
        rooms: [], 
        exams: [], 
        adminUsers: [],
        searchedUsers: [], 
        userSearchQuery: '',
        studentSearchQuery: '',
        selectedBranch: '', 
        selectedSemester: '', 
        activeTab: '',
        studentInfo, 
        studentSeating 
      });
    }
  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).send('Database Error');
  }
});

// ---------------- ADMIN DELEGATION ----------------

app.post('/make_admin/:id', isAuthenticated, isAdmin, async (req, res) => {
  const userId = req.params.id;
  const userSearch = req.body.user_search || '';
  try {
    await User.findByIdAndUpdate(userId, { role: 'admin' });
  } catch (err) { console.error('Make Admin Error:', err); }
  res.redirect(`/?active_tab=admin_users&user_search=${encodeURIComponent(userSearch)}`);
});

app.post('/delete_admin/:id', isAuthenticated, isAdmin, async (req, res) => {
  const adminId = req.params.id;
  const userSearch = req.body.user_search || '';
  try {
    if (adminId !== req.session.user.id) {
      await User.findOneAndDelete({ _id: adminId, role: 'admin' });
    }
  } catch (err) { console.error('Delete Admin Error:', err); }
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
  } catch (err) { console.error('Add Student Error:', err); }

  if (branch && semester) {
    res.redirect(`/?branch=${encodeURIComponent(branch)}&semester=${encodeURIComponent(semester)}`);
  } else {
    res.redirect('/');
  }
});

app.post('/upload_students', isAuthenticated, isAdmin, upload.single('excel_file'), async (req, res) => {
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
          { name: name, branch: branch || null, semester: semester ? parseInt(semester, 10) : null },
          { upsert: true, new: true }
        );
      }
    }
  } catch (err) { console.error('Excel Import Error:', err); }

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
  } catch (err) { console.error('Delete Student Error:', err); }

  if (branch && semester) {
    res.redirect(`/?branch=${encodeURIComponent(branch)}&semester=${encodeURIComponent(semester)}`);
  } else {
    res.redirect('/');
  }
});

// ---------------- ROOM MANAGEMENT ----------------

app.post('/add_room', isAuthenticated, isAdmin, async (req, res) => {
  const { room_no } = req.body;
  let columnRows = req.body['column_rows[]'] || req.body.column_rows;

  if (!Array.isArray(columnRows)) {
    columnRows = columnRows ? [columnRows] : [];
  }

  try {
    let config = [];
    let totalBenches = 0;

    columnRows.forEach((rCount, index) => {
      const r = parseInt(rCount, 10) || 0;
      if (r > 0) {
        config.push({ column_no: index + 1, rows: r });
        totalBenches += r;
      }
    });

    await Room.create({
      room_no: room_no.trim(),
      columns_config: config,
      capacity: totalBenches * 2
    });
  } catch (err) { console.error('Add Room Error:', err); }
  res.redirect('/?active_tab=rooms');
});

app.post('/delete_room/:id', isAuthenticated, isAdmin, async (req, res) => {
  const roomId = req.params.id;
  try {
    await Room.findByIdAndDelete(roomId);
    await Exam.updateMany({ room_id: roomId }, { $set: { room_id: null } });
    await Seating.deleteMany({ room_id: roomId });
  } catch (err) { console.error('Delete Room Error:', err); }
  res.redirect('/?active_tab=rooms');
});

// ---------------- EXAM & SEATING MANAGEMENT ----------------

app.post('/add_exam', isAuthenticated, isAdmin, async (req, res) => {
  const { subject, branch, semester, room_id, exam_date, start_time, end_time } = req.body;
  try {
    await Exam.create({
      subject: subject.trim(),
      branch: branch || null,
      semester: semester ? parseInt(semester, 10) : null,
      room_id: room_id ? room_id : null,
      exam_date: exam_date,
      start_time: start_time,
      end_time: end_time
    });
  } catch (err) { console.error('Add Exam Error:', err); }
  res.redirect('/?active_tab=exams');
});

app.post('/edit_exam/:id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.id;
  const { subject, branch, semester, room_id, exam_date, start_time, end_time } = req.body;
  try {
    await Exam.findByIdAndUpdate(examId, {
      subject: subject.trim(),
      branch: branch || null,
      semester: semester ? parseInt(semester, 10) : null,
      room_id: room_id ? room_id : null,
      exam_date: exam_date,
      start_time: start_time,
      end_time: end_time
    });
  } catch (err) { console.error('Edit Exam Error:', err); }
  res.redirect('/?active_tab=exams');
});

app.post('/delete_exam/:id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.id;
  try {
    await Exam.findByIdAndDelete(examId);
    await Seating.deleteMany({ exam_id: examId });
  } catch (err) { console.error('Delete Exam Error:', err); }
  res.redirect('/?active_tab=exams');
});

// ORIGINAL SEATING ROUTE RESTORED: /generate_seating/:exam_id
app.post('/generate_seating/:exam_id', isAuthenticated, isAdmin, async (req, res) => {
  const examId = req.params.exam_id;
  const { selected_seats } = req.body;

  try {
    const exam = await Exam.findById(examId);
    if (!exam) return res.redirect('/?active_tab=exams');

    const studentFilter = {};
    if (exam.branch) studentFilter.branch = exam.branch;
    if (exam.semester) studentFilter.semester = exam.semester;

    let students = await Student.find(studentFilter);
    students = shuffleArray(students);

    await Seating.deleteMany({ exam_id: examId });

    if (selected_seats) {
      // Custom Graphical Grid Seat Allocation
      let seatsList = typeof selected_seats === 'string' ? JSON.parse(selected_seats) : selected_seats;
      let blueSeats = shuffleArray(seatsList.filter(s => s.color === 'blue'));
      let greenSeats = shuffleArray(seatsList.filter(s => s.color === 'green'));

      let finalSelectedSeats = [];
      let maxLen = Math.max(blueSeats.length, greenSeats.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < blueSeats.length) finalSelectedSeats.push(blueSeats[i]);
        if (i < greenSeats.length) finalSelectedSeats.push(greenSeats[i]);
      }

      for (let i = 0; i < students.length && i < finalSelectedSeats.length; i++) {
        const student = students[i];
        const seat = finalSelectedSeats[i];
        const seatNo = `${seat.room_no}-C${seat.col}-B${seat.row}-${seat.pos}`;

        await Seating.create({
          student_id: student._id,
          exam_id: exam._id,
          room_id: exam.room_id || seat.room_id,
          column_no: seat.col,
          row_no: seat.row,
          seat_position: seat.pos,
          color_tag: seat.color,
          seat_no: seatNo
        });
      }
    } else {
      // Default Auto Allocation
      const rooms = await Room.find(exam.room_id ? { _id: exam.room_id } : {}).sort({ room_no: 1 });
      let sIndex = 0;

      for (const room of rooms) {
        if (!room.columns_config || room.columns_config.length === 0) continue;

        for (const col of room.columns_config) {
          for (let r = 1; r <= col.rows; r++) {
            for (const pos of ['A', 'B']) {
              if (sIndex >= students.length) break;
              const student = students[sIndex];
              const seatNo = `${room.room_no}-C${col.column_no}-B${r}-${pos}`;

              await Seating.create({
                student_id: student._id,
                exam_id: exam._id,
                room_id: room._id,
                column_no: col.column_no,
                row_no: r,
                seat_position: pos,
                color_tag: 'blue',
                seat_no: seatNo
              });
              sIndex++;
            }
            if (sIndex >= students.length) break;
          }
          if (sIndex >= students.length) break;
        }
        if (sIndex >= students.length) break;
      }
    }
  } catch (err) { console.error('Seating Allocation Error:', err); }
  res.redirect('/?active_tab=exams');
});

// GET fallback for old direct generate_seating links
app.get('/generate_seating/:exam_id', isAuthenticated, isAdmin, async (req, res) => {
  req.body.selected_seats = null;
  return app._router.handle(req, res);
});

// ---------------- EXPORTS ----------------

app.get('/export_seating_excel/:exam_id', isAuthenticated, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const seatingDocs = await Seating.find({ exam_id: examId }).populate('student_id').populate('room_id');
    seatingDocs.sort((a, b) => (a.column_no - b.column_no) || (a.row_no - b.row_no));

    const data = seatingDocs.map(s => ({
      'Reg No': s.student_id ? s.student_id.reg_no : 'N/A',
      'Student Name': s.student_id ? s.student_id.name : 'N/A',
      'Branch': s.student_id ? s.student_id.branch : 'N/A',
      'Semester': s.student_id && s.student_id.semester ? `Semester ${s.student_id.semester}` : 'N/A',
      'Room No': s.room_id ? s.room_id.room_no : 'N/A',
      'Column': s.column_no,
      'Bench (Row)': s.row_no,
      'Position': s.seat_position === 'A' ? 'Left (A)' : 'Right (B)',
      'Group Color': s.color_tag ? s.color_tag.toUpperCase() : 'BLUE',
      'Seat No': s.seat_no
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Seating Arrangement');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=seating_exam_${examId}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel Export Error:', err);
    res.status(500).send('Export Error');
  }
});

app.get('/export_seating_pdf/:exam_id', isAuthenticated, async (req, res) => {
  const examId = req.params.exam_id;
  try {
    const seatingDocs = await Seating.find({ exam_id: examId }).populate('student_id').populate('room_id');
    seatingDocs.sort((a, b) => (a.column_no - b.column_no) || (a.row_no - b.row_no));

    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=seating_exam_${examId}.pdf`);
    doc.pipe(res);

    const table = {
      title: `Exam Seating Arrangement (Exam ID: ${examId})`,
      headers: ['Reg No', 'Student Name', 'Branch', 'Sem', 'Room', 'Col', 'Bench', 'Pos', 'Seat No'],
      rows: seatingDocs.map(s => [
        s.student_id ? s.student_id.reg_no : 'N/A',
        s.student_id ? s.student_id.name : 'N/A',
        s.student_id && s.student_id.branch ? s.student_id.branch : 'N/A',
        s.student_id && s.student_id.semester ? `Sem ${s.student_id.semester}` : 'N/A',
        s.room_id ? s.room_id.room_no : 'N/A',
        s.column_no.toString(),
        s.row_no.toString(),
        s.seat_position,
        s.seat_no
      ])
    };

    await doc.table(table);
    doc.end();
  } catch (err) {
    console.error('PDF Export Error:', err);
    res.status(500).send('PDF Generation Error');
  }
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`)))
  .catch(err => console.error('DB Init Error:', err));