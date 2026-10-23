import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "explore", component: () => import("./views/ExploreView.vue") },
  { path: "/overview", name: "overview", component: () => import("./views/OverviewView.vue") },
  { path: "/history", name: "history", component: () => import("./views/HistoryView.vue") },
  { path: "/discounts", name: "discounts", component: () => import("./views/DiscountsView.vue") },
  { path: "/about", name: "about", component: () => import("./views/AboutView.vue") },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});
