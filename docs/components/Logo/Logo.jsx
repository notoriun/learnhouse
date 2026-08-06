import { asset } from '../../lib/site'

function Logo() {
  return (
    <img
      src={asset('/img/logos/learnhouse-dark.svg')}
      alt="LearnHouse"
      style={{ height: 20, width: 'auto' }}
    />
  )
}

export default Logo
