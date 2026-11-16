export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, fetch } = useUserSession()
  if (to.path === '/login') {
    if (loggedIn.value) return navigateTo('/')
    return
  }
  if (!loggedIn.value) {
    await fetch()
  }
  if (!loggedIn.value) return navigateTo('/login')
})
