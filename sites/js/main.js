document.addEventListener("DOMContentLoaded", () => {
  const navbar = document.getElementById("navbar");
  const navMenu = document.getElementById("navMenu");
  const navToggle = document.getElementById("navToggle");
  const previewTabs = document.querySelectorAll(".preview-tab");
  const previewPanels = document.querySelectorAll(".preview-panel");
  const statNumbers = document.querySelectorAll(".stat-number");
  const revealItems = document.querySelectorAll(".reveal");

  navToggle?.addEventListener("click", () => {
    navMenu?.classList.toggle("open");
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", () => {
      navMenu?.classList.remove("open");
    });
  });

  window.addEventListener("scroll", () => {
    navbar?.classList.toggle("scrolled", window.scrollY > 12);
  });

  previewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-panel");

      previewTabs.forEach((item) => item.classList.remove("active"));
      previewPanels.forEach((panel) => panel.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById(`panel-${target}`)?.classList.add("active");
    });
  });

  const animateValue = (element) => {
    const target = Number(element.getAttribute("data-count") ?? 0);
    const duration = 1200;
    const start = performance.now();

    const step = (timestamp) => {
      const progress = Math.min((timestamp - start) / duration, 1);
      element.textContent = String(Math.floor(progress * target));
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("visible");

        if (entry.target.classList.contains("stat-number") && !entry.target.dataset.animated) {
          animateValue(entry.target);
          entry.target.dataset.animated = "true";
        }
      });
    },
    {
      threshold: 0.16,
      rootMargin: "0px 0px -30px 0px",
    },
  );

  revealItems.forEach((item) => observer.observe(item));
  statNumbers.forEach((item) => observer.observe(item));
});
