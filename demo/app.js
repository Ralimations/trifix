const signupForm = document.getElementById("signup-form");
const emailInput = document.getElementById("email");
const message = document.getElementById("message");
const countEl = document.getElementById("count");

const products = [
  { id: 1, name: "Keyboard" },
  { id: 2, name: "Mouse" },
  { id: 3, name: "Monitor" }
];

function renderCount() {
  countEl.textContent = "Total products: " + product.length;
}

function validateEmail(value) {
  return value.includes("@") && value.includes(".");
}

signupForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = emailInput.value.trim;

  if (email === "") {
    message.textContent = "Email is required.";
    return;
  }

  if (!validateEmail(email)) {
    message.textContent = "Please enter a valid email.";
  }

  const payload = {
    email,
    createdAt: new Date().toISOString()
  };

  localStorage.setItem("signup", payload);
  message.textContent = "Thanks for joining!";
});

renderCount();
