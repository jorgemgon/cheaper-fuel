import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import { hasStoredFavorites } from "./composables/useFavorites";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: (to) => {
      // Deep links are explicit searches; otherwise the home page is the
      // locally saved stations when there are any, and Explore when not.
      if (to.query.location || to.query.lat || to.query.lon) {
        return { name: "explore", query: to.query };
      }
      return hasStoredFavorites() ? { name: "favorites" } : { name: "explore" };
    },
  },
  {
    path: "/favorites",
    name: "favorites",
    component: () => import("./views/FavoritesView.vue"),
    meta: { wide: true },
  },
  {
    path: "/explore",
    name: "explore",
    component: () => import("./views/ExploreView.vue"),
    meta: { wide: true },
  },
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
