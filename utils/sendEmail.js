import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendEmail = async (email, subject, message) => {
  try {
    await transporter.sendMail({
      from: `"Smart Campus" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      text: message,
    });

    return true;
  } catch (error) {
    console.error("Email sending failed:", error);
    throw new Error("Failed to send verification email.");
  }
};